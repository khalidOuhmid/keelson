import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import { DocumentStore } from "../src/store.ts";
import { type DocumentEvent, type Watcher, watchDocuments } from "../src/watcher.ts";
import { detectWorkspace } from "../src/workspace.ts";
import { type Harness, startHarness } from "./support/harness.ts";

const MAIN = "stages:\n  - test\n\nsecrets:\n  stage: test\n  script:\n    - gitleaks git\n";

let root = "";
let store: DocumentStore;
let watcher: Watcher | undefined;

function layer(
  body: { coverage: { layers: readonly { layer: string; covered: boolean }[] } },
  id: string,
) {
  return body.coverage.layers.find((entry) => entry.layer === id)?.covered;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-srv-cov-"));
  writeFileSync(join(root, ".gitlab-ci.yml"), MAIN);
  store = new DocumentStore(root, detectWorkspace(root));
});

afterEach(() => {
  watcher?.close();
  watcher = undefined;
  rmSync(root, { recursive: true, force: true });
});

function writeLayout(text: string): void {
  mkdirSync(join(root, ".devsecops"), { recursive: true });
  writeFileSync(join(root, ".devsecops", "layout.json"), text);
}

async function waitForEvent(events: DocumentEvent[]): Promise<DocumentEvent> {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const found = events[0];
    if (found !== undefined) {
      return found;
    }
    await new Promise((settle) => setTimeout(settle, 25));
  }
  throw new Error("no event received");
}

describe("coverage in the payload", () => {
  test("on load", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded === null ? null : layer(loaded, "secrets")).toBe(true);
    expect(loaded === null ? null : layer(loaded, "dast")).toBe(false);
  });

  test("after an operation, recomputed on the new pipeline", async () => {
    await store.load(".gitlab-ci.yml");
    const response = await store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: hashText(MAIN),
        kind: "addJob",
        job: { id: "dast", stage: "test", script: ["nuclei -target x"] },
      },
      "op",
    );
    expect(response.status).toBe(200);
    expect(layer(response.body as never, "dast")).toBe(true);
  });

  test("a layout.json override applies and its diagnostics arrive", async () => {
    writeLayout('{"version":1,"layers":{"secrets":["iast"],"absent":[]}}');
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded === null ? null : layer(loaded, "iast")).toBe(true);
    expect(loaded?.diagnostics.map((entry) => entry.code)).toEqual(["LAYOUT_UNKNOWN_JOB"]);
  });

  /** `JSON.parse` quotes the text it read in its message: without the boundary, the content of an
   *  outside file would leak through a diagnostic's `detail`. */
  test("a layout.json linked outside the root is not read", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-srv-lay-"));
    try {
      writeFileSync(join(outside, "s.json"), "SECRET-HORS-DEPOT");
      mkdirSync(join(root, ".devsecops"));
      symlinkSync(join(outside, "s.json"), join(root, ".devsecops", "layout.json"));
      const loaded = await store.load(".gitlab-ci.yml");
      expect(JSON.stringify(loaded)).not.toContain("SECRET-HORS-DEPOT");
      expect(loaded?.diagnostics).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("watching layout.json", () => {
  test("creating it while .devsecops does not exist updates coverage", async () => {
    const events: DocumentEvent[] = [];
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    writeLayout('{"version":1,"layers":{"secrets":["iast"]}}');

    expect((await waitForEvent(events)).kind).toBe("coverage.changed");
    expect(events[0]).toEqual({ kind: "coverage.changed", file: ".gitlab-ci.yml" });
  });

  test("deleting then recreating the directory keeps the watch", async () => {
    writeLayout('{"version":1}');
    const events: DocumentEvent[] = [];
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    rmSync(join(root, ".devsecops"), { recursive: true });
    await waitForEvent(events);
    await new Promise((settle) => setTimeout(settle, 120));
    writeLayout('{"version":1}');
    await new Promise((settle) => setTimeout(settle, 120));
    events.length = 0;

    writeLayout('{"version":1,"layers":{"secrets":["iast"]}}');
    expect((await waitForEvent(events)).kind).toBe("coverage.changed");
  });

  test("modifying it afterwards emits coverage.changed", async () => {
    writeLayout('{"version":1}');
    const events: DocumentEvent[] = [];
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    writeLayout('{"version":1,"layers":{"secrets":["iast"]}}');
    expect((await waitForEvent(events)).kind).toBe("coverage.changed");
  });
});

describe("layout.json and the main file change together", () => {
  let watcher: Watcher;

  afterEach(() => watcher.close());

  test("the changed pipeline is announced, not just coverage", async () => {
    const events: DocumentEvent[] = [];
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    const changed = `${MAIN}\nnext:\n  stage: test\n  script:\n    - make\n`;
    writeLayout('{"version":1}');
    writeFileSync(join(root, ".gitlab-ci.yml"), changed);

    const first = await waitForEvent(events);
    expect(first).toEqual({
      kind: "document.changed",
      file: ".gitlab-ci.yml",
      hash: hashText(changed),
    });
  });

  test("a deleted main file is announced", async () => {
    const events: DocumentEvent[] = [];
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    rmSync(join(root, ".gitlab-ci.yml"));
    writeLayout('{"version":1}');

    expect(await waitForEvent(events)).toEqual({
      kind: "document.removed",
      file: ".gitlab-ci.yml",
    });
  });
});

describe("a file the parser cannot read", () => {
  test("leaves no unhandled rejection in the watcher", async () => {
    const rejections: unknown[] = [];
    const record = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", record);
    await store.load(".gitlab-ci.yml");
    const watcher = watchDocuments(root, store, () => {});
    try {
      writeFileSync(join(root, ".gitlab-ci.yml"), "job:\n  script: &s [a, *s]\n");
      await new Promise((settle) => setTimeout(settle, 200));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
      watcher.close();
    }
  });
});

describe("re-reading the disk before writing", () => {
  test("an external write the watcher has not seen returns 409 and stays intact", async () => {
    await store.load(".gitlab-ci.yml");
    const external = `${MAIN}# externe\n`;
    writeFileSync(join(root, ".gitlab-ci.yml"), external);

    const response = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: hashText(MAIN), kind: "addStage", name: "verify" },
      "op",
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STALE_DOCUMENT", hash: hashText(external) });
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(external);
  });

  test("a deleted file returns 404 without recreating it", async () => {
    await store.load(".gitlab-ci.yml");
    rmSync(join(root, ".gitlab-ci.yml"));

    const response = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: hashText(MAIN), kind: "addStage", name: "verify" },
      "op",
    );

    expect(response.status).toBe(404);
    expect(existsSync(join(root, ".gitlab-ci.yml"))).toBe(false);
  });
});

describe("after a file the parser cannot read", () => {
  const BROKEN = "job:\n  script: &s [a, *s]\n";
  let watcher: Watcher;

  afterEach(() => watcher.close());

  async function broken(events: DocumentEvent[]): Promise<void> {
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));
    writeFileSync(join(root, ".gitlab-ci.yml"), BROKEN);
    await new Promise((settle) => setTimeout(settle, 200));
  }

  test("an operation does not replace the file with the old text", async () => {
    await broken([]);
    const attempt = store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: hashText(MAIN), kind: "addStage", name: "verify" },
      "op",
    );
    await attempt.catch(() => null);
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(BROKEN);
  });

  test("restoring the same text is announced", async () => {
    const events: DocumentEvent[] = [];
    await broken(events);
    writeFileSync(join(root, ".gitlab-ci.yml"), MAIN);
    expect(await waitForEvent(events)).toEqual({
      kind: "document.changed",
      file: ".gitlab-ci.yml",
      hash: hashText(MAIN),
    });
  });
});

describe("GET /api/catalog", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  test("returns the layers, the tools and the logos", async () => {
    const response = await harness.api("/api/catalog");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      layers: unknown[];
      tools: { id: string }[];
      logos: Record<string, unknown>;
    };
    expect(body.layers).toHaveLength(21);
    expect(body.tools.map((tool) => tool.id)).toContain("trivy");
    expect(Object.keys(body.logos)).toContain("trivy");
  });

  test("requires the token, and GET only", async () => {
    expect((await harness.raw("/api/catalog")).status).toBe(403);
    expect((await harness.api("/api/catalog", { method: "POST" })).status).toBe(405);
  });
});
