import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import { DocumentStore } from "../src/store.ts";
import { detectWorkspace } from "../src/workspace.ts";
import { startHarness } from "./support/harness.ts";

const BASE = "stages:\n  - build\n\ncompile:\n  stage: build\n  script:\n    - make\n";
const FILE = ".gitlab-ci.yml";

let root = "";
let store: DocumentStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "keelson-own-write-"));
  writeFileSync(join(root, FILE), BASE);
  store = new DocumentStore(root, detectWorkspace(root));
  await store.load(FILE);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const addStage = (name: string) => ({
  v: 1 as const,
  baseHash: store.currentHash(FILE) ?? "",
  kind: "addStage" as const,
  name,
});

describe("the server's own write", () => {
  test("its hash is known before the file system announces the write", async () => {
    const mismatches: string[] = [];
    const watcher = watch(root, (_event, name) => {
      if (name !== FILE) {
        return;
      }
      const onDisk = readFileSync(join(root, FILE), "utf8");
      if (hashText(onDisk) !== store.currentHash(FILE)) {
        mismatches.push(name);
      }
    });
    try {
      for (let index = 0; index < 10; index += 1) {
        const result = await store.applyOperation(FILE, addStage(`s${index}`), `op-${index}`);
        expect(result.status).toBe(200);
      }
      await new Promise((settle) => setTimeout(settle, 50));
    } finally {
      watcher.close();
    }
    expect(mismatches).toEqual([]);
  });

  test("a failed write leaves the previous state in the store", async () => {
    const failing = new DocumentStore(root, detectWorkspace(root), async () => {
      throw new Error("disk full");
    });
    await failing.load(FILE);
    const before = failing.currentHash(FILE);
    const request = {
      v: 1 as const,
      baseHash: before ?? "",
      kind: "addStage" as const,
      name: "verify",
    };
    await expect(failing.applyOperation(FILE, request, "op-1")).rejects.toThrow("disk full");
    expect(failing.currentHash(FILE)).toBe(before);
    expect(failing.currentText(FILE)).toBe(BASE);
  });

  test("each write is announced to the listeners with its opId", async () => {
    const written: { file: string; hash: string; opId: string }[] = [];
    const unsubscribe = store.onWritten((event) => written.push(event));
    const result = await store.applyOperation(FILE, addStage("verify"), "op-1");
    await store.applyOperation(FILE, addStage("verify"), "op-1");
    await store.preview(FILE, addStage("other"));
    unsubscribe();
    await store.applyOperation(FILE, addStage("later"), "op-2");

    expect(result.status).toBe(200);
    const hash = (result.body as { hash: string }).hash;
    expect(written).toEqual([{ file: FILE, hash, opId: "op-1" }]);
  });
});

describe("document.written on the event stream", () => {
  test("an operation is announced to every connected tab with its hash and opId", async () => {
    const harness = await startHarness({ text: BASE });
    try {
      await harness.api(`/api/documents/${FILE}`);
      const stream = await harness.raw(`/api/events?token=${harness.server.token}`);
      const reader = stream.body?.getReader();
      const response = await harness.api(`/api/documents/${FILE}/operations`, {
        method: "POST",
        body: JSON.stringify({
          opId: "op-tab-a",
          op: { v: 1, baseHash: hashText(BASE), kind: "addStage", name: "verify" },
        }),
      });
      const { hash } = (await response.json()) as { hash: string };
      let seen = "";
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && !seen.includes("document.written")) {
        const chunk = await Promise.race([
          reader?.read(),
          new Promise<undefined>((settle) => setTimeout(settle, 100)),
        ]);
        seen += chunk?.value === undefined ? "" : new TextDecoder().decode(chunk.value);
      }
      await reader?.cancel();
      expect(seen).toContain(
        `event: document.written\ndata: ${JSON.stringify({ file: FILE, hash, opId: "op-tab-a" })}\n\n`,
      );
    } finally {
      await harness.close();
    }
  });
});
