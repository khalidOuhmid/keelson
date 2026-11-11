import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "../src/store.ts";
import { type DocumentEvent, type Watcher, watchDocuments } from "../src/watcher.ts";
import { detectWorkspace } from "../src/workspace.ts";

const BASE = [
  "stages:",
  "  - build",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
].join("\n");

let root = "";
let store: DocumentStore;
let watcher: Watcher | undefined;
let events: DocumentEvent[] = [];

function path(): string {
  return join(root, ".gitlab-ci.yml");
}

async function settle(ms = 220): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEvent(kind: DocumentEvent["kind"], timeout = 2500): Promise<DocumentEvent> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = events.find((event) => event.kind === kind);
    if (found !== undefined) {
      return found;
    }
    await settle(25);
  }
  throw new Error(`no "${kind}" event received; received: ${JSON.stringify(events)}`);
}

beforeEach(async () => {
  events = [];
  root = mkdtempSync(join(tmpdir(), "keelson-watch-"));
  writeFileSync(path(), BASE);
  store = new DocumentStore(root, detectWorkspace(root));
  await store.load(".gitlab-ci.yml");
  watcher = watchDocuments(root, store, (event) => events.push(event));
  await settle(60);
});

afterEach(() => {
  watcher?.close();
  watcher = undefined;
});

describe("external modification", () => {
  test("an outside write emits document.changed with the new hash", async () => {
    writeFileSync(path(), `${BASE}\nother:\n  stage: build\n  script:\n    - echo\n`);
    const event = await waitForEvent("document.changed");
    expect(event).toMatchObject({ file: ".gitlab-ci.yml" });
    expect(event.kind).toBe("document.changed");
    if (event.kind === "document.changed") {
      expect(store.currentHash(".gitlab-ci.yml")).toBe(event.hash);
    }
  });

  test("the store is reloaded after an external modification", async () => {
    writeFileSync(path(), `${BASE}\nother:\n  stage: build\n  script:\n    - echo\n`);
    await waitForEvent("document.changed");
    expect(store.currentText(".gitlab-ci.yml")).toContain("other:");
  });

  test("a replacement by rename is detected", async () => {
    const temporary = join(root, "replacement.tmp");
    writeFileSync(temporary, `${BASE}\nreplaced:\n  stage: build\n  script:\n    - echo\n`);
    renameSync(temporary, path());
    await waitForEvent("document.changed");
    expect(store.currentText(".gitlab-ci.yml")).toContain("replaced:");
  });

  test("deleting the file emits document.removed", async () => {
    rmSync(path());
    const event = await waitForEvent("document.removed");
    expect(event).toMatchObject({ file: ".gitlab-ci.yml" });
  });
});

describe("the server's own writes", () => {
  test("an operation applied by the server does not emit document.changed", async () => {
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
        kind: "addStage",
        name: "verify",
      },
      "op-1",
    );
    expect(result.status).toBe(200);
    await settle(400);
    expect(events).toEqual([]);
  });

  test("rewriting the same content emits nothing", async () => {
    writeFileSync(path(), BASE);
    await settle(400);
    expect(events).toEqual([]);
  });

  test("an external modification after an own write is detected", async () => {
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
    await settle(300);
    expect(events).toEqual([]);

    writeFileSync(path(), `${BASE}\nexterne:\n  stage: build\n  script:\n    - echo\n`);
    const event = await waitForEvent("document.changed");
    expect(event.kind).toBe("document.changed");
  });
});

describe("lifecycle", () => {
  test("close stops emitting events", async () => {
    watcher?.close();
    watcher = undefined;
    writeFileSync(path(), `${BASE}\napres:\n  stage: build\n  script:\n    - echo\n`);
    await settle(400);
    expect(events).toEqual([]);
  });

  test("close is idempotent", () => {
    expect(() => {
      watcher?.close();
      watcher?.close();
    }).not.toThrow();
  });

  test("the watcher watches the directory, not just the file", async () => {
    rmSync(path());
    await waitForEvent("document.removed");
    events = [];

    writeFileSync(path(), `${BASE}\nrecreated:\n  stage: build\n  script:\n    - echo\n`);
    const event = await waitForEvent("document.changed");
    expect(event.kind).toBe("document.changed");
    expect(store.currentText(".gitlab-ci.yml")).toContain("recreated:");
  });

  test("another file in the directory is ignored", async () => {
    writeFileSync(join(root, "unrelated.txt"), "noise\n");
    await settle(400);
    expect(events).toEqual([]);
  });
});
