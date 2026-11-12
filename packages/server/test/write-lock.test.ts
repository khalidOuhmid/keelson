import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText, TOOLCHAIN_FILE } from "@keelson/core";
import { withFileLock } from "../src/lock.ts";
import { DocumentStore } from "../src/store.ts";
import { ToolchainStore } from "../src/toolchain.ts";
import { detectWorkspace } from "../src/workspace.ts";

const BASE = "stages:\n  - build\n\ncompile:\n  stage: build\n  script:\n    - make\n";
const CONCURRENT = `${BASE}\nlint:\n  stage: build\n  script:\n    - lint\n`;
const FILE = ".gitlab-ci.yml";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-write-lock-"));
  writeFileSync(join(root, FILE), BASE);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Holds the lock as another process would, writes while holding it, then releases it. */
async function holdWhile<T>(path: string, during: () => Promise<T>, write: () => void) {
  let started: Promise<T> | undefined;
  await withFileLock(root, path, async () => {
    started = during();
    await new Promise((settle) => setTimeout(settle, 80));
    write();
  });
  return started as Promise<T>;
}

describe("the server's writes take the shared lock", () => {
  test("an operation waits for a held lock and sees the write made under it", async () => {
    const store = new DocumentStore(root, detectWorkspace(root));
    await store.load(FILE);
    const operation = {
      v: 1 as const,
      baseHash: store.currentHash(FILE) ?? "",
      kind: "addStage" as const,
      name: "deploy",
    };

    const response = await holdWhile(
      join(root, FILE),
      () => store.applyOperation(FILE, operation, "op-1"),
      () => writeFileSync(join(root, FILE), CONCURRENT),
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STALE_DOCUMENT" });
    expect(readFileSync(join(root, FILE), "utf8")).toBe(CONCURRENT);
    expect(readdirSync(root)).toEqual([FILE]);
  });

  test("a toolchain operation waits for a held lock and sees the write made under it", async () => {
    const store = new DocumentStore(root, detectWorkspace(root));
    const toolchain = new ToolchainStore(root, store);
    const concurrent = "version: 1\nservices:\n  vault:\n    tool: vault\n";
    mkdirSync(join(root, ".devsecops"));

    const response = await holdWhile(
      join(root, TOOLCHAIN_FILE),
      () =>
        toolchain.apply(
          {
            v: 1,
            baseHash: hashText(""),
            kind: "addService",
            id: "nexus",
            tool: "nexus",
            url: null,
            environment: null,
          },
          "op-1",
        ),
      () => writeFileSync(join(root, TOOLCHAIN_FILE), concurrent),
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STALE_DOCUMENT" });
    expect(readFileSync(join(root, TOOLCHAIN_FILE), "utf8")).toBe(concurrent);
    expect(readdirSync(join(root, ".devsecops"))).toEqual(["toolchain.yaml"]);
  });
});
