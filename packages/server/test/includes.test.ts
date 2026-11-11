import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "../src/store.ts";
import { type DocumentEvent, type Watcher, watchDocuments } from "../src/watcher.ts";
import { detectWorkspace } from "../src/workspace.ts";

const MAIN = [
  "include: /ci/jobs.yml",
  "",
  "stages:",
  "  - build",
  "  - test",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "  script:",
  "    - make check",
  "",
].join("\n");

const INCLUDED = ["compile:", "  stage: build", "  script:", "    - make", ""].join("\n");

let root = "";
let store: DocumentStore;
let watcher: Watcher | undefined;
let events: DocumentEvent[] = [];

function write(relative: string, text: string): void {
  const absolute = join(root, relative);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, text);
}

async function settle(ms = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEvent(timeout = 2500): Promise<DocumentEvent> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = events[0];
    if (found !== undefined) {
      return found;
    }
    await settle();
  }
  throw new Error("no event received");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-srv-inc-"));
  write(".gitlab-ci.yml", MAIN);
  write("ci/jobs.yml", INCLUDED);
  store = new DocumentStore(root, detectWorkspace(root));
  events = [];
});

afterEach(() => {
  watcher?.close();
  watcher = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("loading a document with includes", () => {
  test("the pipeline contains the included files' jobs", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.pipeline.jobs.map((job) => job.id).sort()).toEqual(["compile", "unit"]);
  });

  /** Without the included files' texts on the wire, the UI would slice the ranges of an included
   *  job's opaque blocks out of the main file's text: bytes taken from elsewhere, displayed under
   *  the sole promise "this is verbatim". */
  test("the payload carries the text of each included file", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.included).toEqual({ "ci/jobs.yml": INCLUDED });
  });

  test("a need on an included job is no longer an UNKNOWN_NEED", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.diagnostics.map((entry) => entry.code)).toEqual([]);
  });

  test("the store exposes the document's included files", async () => {
    await store.load(".gitlab-ci.yml");
    expect(store.includedFiles(".gitlab-ci.yml")).toEqual(["ci/jobs.yml"]);
  });
});

describe("a symbolic link that escapes the root", () => {
  /** The real consequence of the defect found by the L2b review is not that a `read()` returns a
   *  value: it is that the content of an arbitrary file ends up in the payload sent to the browser.
   *  `reader.test.ts` guards the reader, this test guards the payload. */
  test("its content does not enter the document payload", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-srv-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "SECRET-OUTSIDE-REPO\n");
      symlinkSync(join(outside, "secret.txt"), join(root, "ci", "leak.yml"));
      write(".gitlab-ci.yml", MAIN.replace("/ci/jobs.yml", "/ci/leak.yml"));

      const loaded = await store.load(".gitlab-ci.yml");

      expect(JSON.stringify(loaded)).not.toContain("SECRET-OUTSIDE-REPO");
      expect(loaded?.included).toEqual({});
      expect(loaded?.diagnostics.map((entry) => entry.code)).toContain("INCLUDE_NOT_FOUND");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("a main file linked outside the root", () => {
  /** The main file did not go through the reader: a `.gitlab-ci.yml` linked to any file went into
   *  the payload as is, without even an extension check. Same scenario as the included link,
   *  through the only path the L2b fix had not closed. */
  function linkMainOutside(): string {
    const outside = mkdtempSync(join(tmpdir(), "keelson-srv-main-"));
    writeFileSync(join(outside, "s.yml"), "SECRET_KEY: OUTSIDE-ROOT\n");
    rmSync(join(root, ".gitlab-ci.yml"));
    symlinkSync(join(outside, "s.yml"), join(root, ".gitlab-ci.yml"));
    return outside;
  }

  test("it is not detected as a workspace file", () => {
    const outside = linkMainOutside();
    try {
      expect(detectWorkspace(root)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("the store does not load it, even if the list names it", async () => {
    const outside = linkMainOutside();
    try {
      const forced = new DocumentStore(root, [{ path: ".gitlab-ci.yml", adapter: "gitlab" }]);
      expect(await forced.load(".gitlab-ci.yml")).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("writes bounded to the main file", () => {
  test("an operation on an included job is refused with 422", async () => {
    await store.load(".gitlab-ci.yml");
    const response = await store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
        kind: "removeJob",
        id: "compile",
      },
      "op-1",
    );

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      code: "FROM_INCLUDED_FILE",
      params: { reason: "job", job: "compile", file: "ci/jobs.yml" },
    });
  });

  /** The product's guarantee, measured on disk and not on intent: the included file must be
   *  **byte for byte** the one from before, after an accepted operation. */
  test("an accepted operation does not rewrite the included file", async () => {
    await store.load(".gitlab-ci.yml");
    const response = await store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
        kind: "addStage",
        name: "ship",
      },
      "op-2",
    );

    expect(response.status).toBe(200);
    expect(readFileSync(join(root, "ci/jobs.yml"), "utf8")).toBe(INCLUDED);
  });

  /** `resolveWorkspaceFile` only knows the detected file. An included file therefore never enters
   *  the write allowlist, even if the client asks for its name. */
  test("an included file is not addressable as a document", async () => {
    expect(await store.load("ci/jobs.yml")).toBeNull();
  });
});

describe("watching included files", () => {
  test("modifying an included file emits document.changed on the main file", async () => {
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    write("ci/jobs.yml", `${INCLUDED}\nextra:\n  stage: build\n  script:\n    - make extra\n`);

    const event = await waitForEvent();
    expect(event.kind).toBe("document.changed");
    expect(event.kind === "document.changed" ? event.file : "").toBe(".gitlab-ci.yml");
    expect(store.includedFiles(".gitlab-ci.yml")).toEqual(["ci/jobs.yml"]);
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.pipeline.jobs.map((job) => job.id).sort()).toEqual(["compile", "extra", "unit"]);
  });

  /** The trap the `onLoaded` hook avoids: the watcher is built **before** any load, so
   *  `includedFiles` is empty at that point. Without subscribing to loads, the `ci/` directory
   *  would only be watched after a first change — that is, the first change would always be
   *  missed. */
  test("the included file is watched even if the watcher starts before any load", async () => {
    watcher = watchDocuments(root, store, (event) => events.push(event));
    await store.load(".gitlab-ci.yml");

    write("ci/jobs.yml", `${INCLUDED}\ntardif:\n  stage: build\n  script:\n    - make\n`);

    const event = await waitForEvent();
    expect(event.kind === "document.changed" ? event.file : "").toBe(".gitlab-ci.yml");
  });

  /** The store purges the document, so the screen must learn it: otherwise it stays on a pipeline
   *  that no longer exists, until the next operation's 404. */
  test("a main file replaced by a refused link emits document.removed", async () => {
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    const outside = mkdtempSync(join(tmpdir(), "keelson-srv-became-"));
    try {
      writeFileSync(join(outside, "s.yml"), "SECRET_KEY: OUTSIDE-ROOT\n");
      rmSync(join(root, ".gitlab-ci.yml"));
      symlinkSync(join(outside, "s.yml"), join(root, ".gitlab-ci.yml"));

      const event = await waitForEvent();
      expect(event).toEqual({ kind: "document.removed", file: ".gitlab-ci.yml" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("an include added afterwards enters the watch", async () => {
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    write("ci/second.yml", "second:\n  stage: build\n  script:\n    - make\n");
    write(
      ".gitlab-ci.yml",
      MAIN.replace("include: /ci/jobs.yml", "include:\n  - /ci/jobs.yml\n  - /ci/second.yml"),
    );
    await waitForEvent();
    events = [];

    write("ci/second.yml", "second:\n  stage: test\n  script:\n    - make\n");
    const event = await waitForEvent();
    expect(event.kind === "document.changed" ? event.file : "").toBe(".gitlab-ci.yml");
  });

  test("a file outside the resolved tree emits nothing", async () => {
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    write("ci/never-included.yml", "nothing:\n  stage: build\n  script:\n    - make\n");
    await settle(300);
    expect(events).toEqual([]);
  });
});
