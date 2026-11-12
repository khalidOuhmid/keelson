import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INVALID_OPERATION } from "@keelson/core/messages";
import { DocumentStore } from "../src/store.ts";
import { type DocumentEvent, type Watcher, watchDocuments } from "../src/watcher.ts";
import { detectWorkspace } from "../src/workspace.ts";

const BASE = "stages:\n  - build\n\ncompile:\n  stage: build\n  script:\n    - make\n";
const FILE = ".gitlab-ci.yml";

let root = "";
let store: DocumentStore;
let watcher: Watcher | undefined;
let events: DocumentEvent[] = [];

const addStage = (name: string) => ({
  v: 1 as const,
  baseHash: store.currentHash(FILE) ?? "",
  kind: "addStage" as const,
  name,
});

beforeEach(() => {
  events = [];
  root = mkdtempSync(join(tmpdir(), "keelson-links-"));
});

afterEach(() => {
  watcher?.close();
  watcher = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function open(): Promise<void> {
  store = new DocumentStore(root, detectWorkspace(root));
  await store.load(FILE);
}

describe("a main file that is a link inside the repository", () => {
  beforeEach(async () => {
    mkdirSync(join(root, "ci"));
    writeFileSync(join(root, "ci/main.yml"), BASE);
    symlinkSync("ci/main.yml", join(root, FILE));
    await open();
  });

  test("an operation writes the target and keeps the link", async () => {
    const result = await store.applyOperation(FILE, addStage("verify"), "op-1");
    expect(result.status).toBe(200);
    expect(lstatSync(join(root, FILE)).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, "ci/main.yml"), "utf8")).toContain("- verify");
  });

  test("modifying the target emits document.changed for the main file", async () => {
    watcher = watchDocuments(root, store, (event) => events.push(event));
    await new Promise((settle) => setTimeout(settle, 60));
    writeFileSync(join(root, "ci/main.yml"), `${BASE}# edited\n`);
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && !events.some((event) => event.kind === "document.changed")) {
      await new Promise((settle) => setTimeout(settle, 25));
    }
    expect(events).toContainEqual({
      kind: "document.changed",
      file: FILE,
      hash: store.currentHash(FILE) ?? "",
    });
  });
});

describe("a main file that is not UTF-8", () => {
  const bytes = Buffer.concat([
    Buffer.from("# caf"),
    Buffer.from([0xe9]),
    Buffer.from(`\n${BASE}`),
  ]);

  beforeEach(async () => {
    writeFileSync(join(root, FILE), bytes);
    await open();
  });

  test("an operation is refused and the bytes stay as they are", async () => {
    const result = await store.applyOperation(FILE, addStage("verify"), "op-1");
    expect(result).toEqual({
      status: 422,
      body: { code: INVALID_OPERATION, params: { reason: "notUtf8", file: FILE } },
    });
    expect(readFileSync(join(root, FILE)).equals(bytes)).toBe(true);
  });

  test("a preview is refused the same way", async () => {
    const result = await store.preview(FILE, addStage("verify"));
    expect(result.status).toBe(422);
  });

  test("a literal replacement character in a UTF-8 file is not mistaken for it", async () => {
    writeFileSync(join(root, FILE), `# �\n${BASE}`);
    await open();
    const result = await store.applyOperation(FILE, addStage("verify"), "op-2");
    expect(result.status).toBe(200);
  });
});
