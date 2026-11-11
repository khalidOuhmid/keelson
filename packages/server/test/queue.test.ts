import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import type { ErrorBody } from "../src/store.ts";
import { DocumentStore } from "../src/store.ts";
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
  "unit:",
  "  stage: test",
  "  script:",
  "    - make check",
  "",
].join("\n");

let root = "";
let store: DocumentStore;

function makeStore(text = BASE): DocumentStore {
  root = mkdtempSync(join(tmpdir(), "keelson-queue-"));
  writeFileSync(join(root, ".gitlab-ci.yml"), text);
  return new DocumentStore(root, detectWorkspace(root));
}

beforeEach(() => {
  store = makeStore();
});

describe("per-document queue", () => {
  test("two operations launched in parallel are applied in series", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded).not.toBeNull();
    const first = store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: loaded?.hash ?? "",
        kind: "addStage",
        name: "verify",
      },
      "op-1",
    );

    const second = first.then(() =>
      store.applyOperation(
        ".gitlab-ci.yml",
        {
          v: 1,
          baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
          kind: "addStage",
          name: "publish",
        },
        "op-2",
      ),
    );

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toContain("verify");
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toContain("publish");
  });

  test("two concurrent operations on the same hash: the second is stale, none is lost", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const baseHash = loaded?.hash ?? "";

    const results = await Promise.all([
      store.applyOperation(
        ".gitlab-ci.yml",
        { v: 1, baseHash, kind: "addStage", name: "verify" },
        "op-a",
      ),
      store.applyOperation(
        ".gitlab-ci.yml",
        { v: 1, baseHash, kind: "addStage", name: "publish" },
        "op-b",
      ),
    ]);

    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);

    const stale = results.find((result) => result.status === 409);
    expect((stale?.body as ErrorBody | undefined)?.code).toBe("STALE_DOCUMENT");
    expect((stale?.body as ErrorBody | undefined)?.hash).toBe(store.currentHash(".gitlab-ci.yml"));

    const onDisk = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    const applied = results.find((result) => result.status === 200);
    expect(applied).toBeDefined();
    expect(store.currentText(".gitlab-ci.yml")).toBe(onDisk);
  });

  test("ten chained operations all succeed", async () => {
    await store.load(".gitlab-ci.yml");
    for (let index = 0; index < 10; index += 1) {
      const result = await store.applyOperation(
        ".gitlab-ci.yml",
        {
          v: 1,
          baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
          kind: "addStage",
          name: `etape-${index}`,
        },
        `op-${index}`,
      );
      expect(result.status).toBe(200);
    }
    const text = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    for (let index = 0; index < 10; index += 1) {
      expect(text).toContain(`etape-${index}`);
    }
  });

  test("the current hash follows the last written state", async () => {
    await store.load(".gitlab-ci.yml");
    await store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
        kind: "addStage",
        name: "verify",
      },
      "op-1",
    );
    const onDisk = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    expect(store.currentHash(".gitlab-ci.yml")).toBe(hashText(onDisk));
  });

  test("a domain error writes nothing and leaves the hash unchanged", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const before = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "removeJob", id: "absent" },
      "op-ko",
    );
    expect(result.status).toBe(422);
    expect((result.body as ErrorBody).code).toBe("JOB_NOT_FOUND");
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(before);
    expect(store.currentHash(".gitlab-ci.yml")).toBe(loaded?.hash);
  });

  test("an operation with an invalid schema returns 400 without writing", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const before = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "dropDatabase" } as never,
      "op-bad",
    );
    expect(result.status).toBe(400);
    expect((result.body as ErrorBody).code).toBe("INVALID_OPERATION");
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(before);
  });

  test("a file outside the workspace list returns 404", async () => {
    const result = await store.applyOperation(
      "autre.yml",
      { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "x" },
      "op-404",
    );
    expect(result.status).toBe(404);
  });

  test("the successful response carries pipeline, diagnostics, hash, inverse and touched", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "addStage", name: "verify" },
      "op-1",
    );
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    for (const key of ["pipeline", "diagnostics", "hash", "inverse", "touched"]) {
      expect(body[key]).toBeDefined();
    }
  });
});
