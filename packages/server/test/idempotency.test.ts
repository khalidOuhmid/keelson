import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ErrorBody } from "../src/store.ts";
import { DocumentStore, OPID_HISTORY } from "../src/store.ts";
import { detectWorkspace } from "../src/workspace.ts";

const BASE = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
].join("\n");

let root = "";
let store: DocumentStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-idem-"));
  writeFileSync(join(root, ".gitlab-ci.yml"), BASE);
  store = new DocumentStore(root, detectWorkspace(root));
});

async function addStage(name: string, opId: string, baseHash?: string) {
  return store.applyOperation(
    ".gitlab-ci.yml",
    {
      v: 1,
      baseHash: baseHash ?? store.currentHash(".gitlab-ci.yml") ?? "",
      kind: "addStage",
      name,
    },
    opId,
  );
}

describe("idempotency by opId", () => {
  test("the same opId replayed returns exactly the same response", async () => {
    await store.load(".gitlab-ci.yml");
    const first = await addStage("verify", "op-1");
    const replay = await addStage("verify", "op-1");
    expect(replay).toEqual(first);
  });

  test("the replay does not rewrite the file", async () => {
    await store.load(".gitlab-ci.yml");
    await addStage("verify", "op-1");
    const path = join(root, ".gitlab-ci.yml");
    const afterFirst = statSync(path).mtimeMs;
    const content = readFileSync(path, "utf8");

    await new Promise((resolve) => setTimeout(resolve, 15));
    await addStage("verify", "op-1");

    expect(statSync(path).mtimeMs).toBe(afterFirst);
    expect(readFileSync(path, "utf8")).toBe(content);
  });

  test("the replay succeeds even if the original baseHash is now stale", async () => {
    await store.load(".gitlab-ci.yml");
    const original = store.currentHash(".gitlab-ci.yml") ?? "";
    const first = await addStage("verify", "op-1", original);
    await addStage("publish", "op-2");

    const replay = await addStage("verify", "op-1", original);
    expect(replay.status).toBe(200);
    expect(replay).toEqual(first);
  });

  test("replaying a refused operation returns the same error", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const first = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "removeJob", id: "absent" },
      "op-ko",
    );
    const replay = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "removeJob", id: "absent" },
      "op-ko",
    );
    expect(replay).toEqual(first);
    expect(replay.status).toBe(422);
  });

  test("two different opIds produce two writes", async () => {
    await store.load(".gitlab-ci.yml");
    await addStage("verify", "op-1");
    await addStage("publish", "op-2");
    const text = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    expect(text).toContain("verify");
    expect(text).toContain("publish");
  });

  test("the history is bounded and forgets the oldest opIds", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const original = loaded?.hash ?? "";
    expect(OPID_HISTORY).toBe(100);

    await addStage("etape-0", "op-0", original);
    expect(store.rememberedOpIds(".gitlab-ci.yml")).toContain("op-0");

    for (let index = 1; index <= OPID_HISTORY; index += 1) {
      await addStage(`etape-${index}`, `op-${index}`);
    }

    expect(store.rememberedOpIds(".gitlab-ci.yml")).toHaveLength(OPID_HISTORY);
    expect(store.rememberedOpIds(".gitlab-ci.yml")).not.toContain("op-0");

    const rejoue = await addStage("etape-0", "op-0", original);
    expect(rejoue.status).toBe(409);
    expect((rejoue.body as ErrorBody).code).toBe("STALE_DOCUMENT");
  });

  test("an opId still in memory is replayed, not re-executed", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const original = loaded?.hash ?? "";
    const first = await addStage("verify", "op-garde", original);

    for (let index = 1; index < OPID_HISTORY; index += 1) {
      await addStage(`etape-${index}`, `op-${index}`);
    }

    expect(store.rememberedOpIds(".gitlab-ci.yml")).toContain("op-garde");
    expect(await addStage("verify", "op-garde", original)).toEqual(first);
  });

  test("the history is kept per document", async () => {
    writeFileSync(join(root, "autre.yml"), BASE);
    await store.load(".gitlab-ci.yml");
    const first = await addStage("verify", "partage");
    const replay = await addStage("verify", "partage");
    expect(replay).toEqual(first);
    expect(store.rememberedOpIds(".gitlab-ci.yml")).toContain("partage");
    expect(store.rememberedOpIds("autre.yml")).toEqual([]);
  });
});
