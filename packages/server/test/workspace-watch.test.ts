import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "../src/store.ts";
import { type DocumentEvent, type Watcher, watchDocuments } from "../src/watcher.ts";
import { detectWorkspace } from "../src/workspace.ts";

const WORKFLOW =
  "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n";
const GITLAB = "stages:\n  - build\n\ncompile:\n  stage: build\n  script:\n    - make\n";

let root = "";
let store: DocumentStore;
let watcher: Watcher | undefined;
let events: DocumentEvent[] = [];

async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: (event: DocumentEvent) => boolean,
  timeout = 2500,
): Promise<DocumentEvent> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found !== undefined) {
      return found;
    }
    await settle(25);
  }
  throw new Error(`no matching event; received: ${JSON.stringify(events)}`);
}

const workspaceListing = (paths: string[]) => (event: DocumentEvent) =>
  event.kind === "workspace.changed" &&
  JSON.stringify(event.files.map((file) => file.path)) === JSON.stringify(paths);

async function start(): Promise<void> {
  store = new DocumentStore(root, detectWorkspace(root));
  watcher = watchDocuments(root, store, (event) => events.push(event));
  await settle(60);
}

beforeEach(() => {
  events = [];
  root = mkdtempSync(join(tmpdir(), "keelson-workspace-"));
});

afterEach(() => {
  watcher?.close();
  watcher = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("workflows created or removed while the server runs", () => {
  test("a workflow created after startup joins the workspace and is announced", async () => {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), WORKFLOW);
    await start();

    writeFileSync(join(root, ".github/workflows/release.yml"), WORKFLOW);
    const event = await waitFor(
      workspaceListing([".github/workflows/ci.yml", ".github/workflows/release.yml"]),
    );
    expect(event).toEqual({
      kind: "workspace.changed",
      files: [
        { path: ".github/workflows/ci.yml", adapter: "github" },
        { path: ".github/workflows/release.yml", adapter: "github" },
      ],
    });
    expect(store.workspaceFiles().map((file) => file.path)).toContain(
      ".github/workflows/release.yml",
    );
    expect(await store.load(".github/workflows/release.yml")).not.toBeNull();
  });

  test("a removed workflow leaves the workspace", async () => {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), WORKFLOW);
    writeFileSync(join(root, ".github/workflows/release.yml"), WORKFLOW);
    await start();

    rmSync(join(root, ".github/workflows/release.yml"));
    await waitFor(workspaceListing([".github/workflows/ci.yml"]));
    expect(store.workspaceFiles().map((file) => file.path)).toEqual([".github/workflows/ci.yml"]);
  });

  test("a file that is not a workflow announces nothing", async () => {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), WORKFLOW);
    await start();

    writeFileSync(join(root, ".github/workflows/notes.txt"), "not a workflow");
    await settle(300);
    expect(events.filter((event) => event.kind === "workspace.changed")).toEqual([]);
  });

  test(".github/workflows created from nothing is watched", async () => {
    writeFileSync(join(root, ".gitlab-ci.yml"), GITLAB);
    await start();

    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    await settle(120);
    writeFileSync(join(root, ".github/workflows/ci.yml"), WORKFLOW);
    await waitFor(workspaceListing([".gitlab-ci.yml", ".github/workflows/ci.yml"]));
  });

  test(".github/workflows deleted then recreated is still watched", async () => {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), WORKFLOW);
    await start();

    rmSync(join(root, ".github/workflows"), { recursive: true });
    await waitFor(workspaceListing([]));
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    await settle(120);
    writeFileSync(join(root, ".github/workflows/ci.yml"), WORKFLOW);
    await waitFor(workspaceListing([".github/workflows/ci.yml"]));

    await store.load(".github/workflows/ci.yml");
    events = [];
    writeFileSync(join(root, ".github/workflows/ci.yml"), `${WORKFLOW}# edited\n`);
    await waitFor(
      (event) => event.kind === "document.changed" && event.file === ".github/workflows/ci.yml",
    );
  });

  test("a .gitlab-ci.yml created after startup joins the workspace", async () => {
    await start();

    writeFileSync(join(root, ".gitlab-ci.yml"), GITLAB);
    await waitFor(workspaceListing([".gitlab-ci.yml"]));
  });

  test("a workflow that is not open still reports its changes", async () => {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/ci.yml"), WORKFLOW);
    writeFileSync(join(root, ".github/workflows/release.yml"), WORKFLOW);
    await start();
    await store.load(".github/workflows/ci.yml");

    writeFileSync(join(root, ".github/workflows/release.yml"), `${WORKFLOW}# edited\n`);
    await waitFor(
      (event) =>
        event.kind === "document.changed" && event.file === ".github/workflows/release.yml",
    );
  });
});
