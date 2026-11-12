import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
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
import { hashText } from "@keelson/core";
import { createServer } from "../src/index.ts";
import { DocumentStore } from "../src/store.ts";
import { type DocumentEvent, watchDocuments } from "../src/watcher.ts";
import { detectWorkspace } from "../src/workspace.ts";
import { type Harness, startHarness } from "./support/harness.ts";

const MAIN =
  "stages:\n  - build\n\nbuild:\n  stage: build\n  script:\n    - curl https://nexus.example.org/x\n";
const FILE = ".devsecops/toolchain.yaml";
const TEXT = "version: 1\nservices:\n  nexus:\n    tool: nexus\n";

type Body = {
  text: string;
  hash: string;
  toolchain: { services: { id: string }[] };
  diagnostics: { code: string }[];
  proposed: { job: string; tool: string }[];
  positions: Record<string, unknown>;
  inverse?: unknown;
  code?: string;
  hash2?: string;
};

let harness: Harness;

function disk(path: string): string {
  return join(harness.root, path);
}

function write(path: string, text: string): void {
  mkdirSync(join(disk(path), ".."), { recursive: true });
  writeFileSync(disk(path), text);
}

async function get(): Promise<Body> {
  return (await (await harness.api("/api/toolchain")).json()) as Body;
}

async function post(op: Record<string, unknown>, opId = "op-1") {
  const response = await harness.api("/api/toolchain/operations", {
    method: "POST",
    body: JSON.stringify({ op: { v: 1, ...op }, opId }),
  });
  return { status: response.status, body: (await response.json()) as Body };
}

const addHarbor = {
  kind: "addService",
  id: "harbor",
  tool: "harbor",
  url: null,
  environment: null,
};

beforeEach(async () => {
  harness = await startHarness({ text: MAIN });
  await harness.api("/api/documents/.gitlab-ci.yml");
});

afterEach(async () => {
  await harness.close();
});

describe("GET /api/toolchain", () => {
  test("without a file: an empty toolchain and the empty text's hash", async () => {
    const body = await get();
    expect(body.text).toBe("");
    expect(body.hash).toBe(hashText(""));
    expect(body.toolchain.services).toEqual([]);
    expect(existsSync(disk(FILE))).toBe(false);
  });

  test("returns the proposals and diagnostics of the current pipeline", async () => {
    write(FILE, `${TEXT}integrations:\n  - job: fantome\n    service: nexus\n    kind: push\n`);
    const body = await get();
    expect(body.diagnostics.map((entry) => entry.code)).toEqual(["TOOLCHAIN_UNKNOWN_JOB"]);
    expect(body.proposed.map((entry) => entry.tool)).toEqual(["nexus"]);
  });

  test("toolchain diagnostics also arrive with the document", async () => {
    write(FILE, "version: 2\n");
    const response = await harness.api("/api/documents/.gitlab-ci.yml");
    const body = (await response.json()) as Body;
    expect(body.diagnostics.map((entry) => entry.code)).toContain("TOOLCHAIN_INVALID");
  });

  test("a declared service counts towards the document's coverage", async () => {
    write(FILE, TEXT);
    const body = (await (await harness.api("/api/documents/.gitlab-ci.yml")).json()) as {
      coverage: { layers: { layer: string; services: string[] }[] };
    };
    const registry = body.coverage.layers.find((entry) => entry.layer === "registry");
    expect(registry?.services).toEqual(["nexus"]);
  });

  test("a link outside the root reads as a missing file", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-out-"));
    writeFileSync(join(outside, "t.yaml"), TEXT);
    mkdirSync(disk(".devsecops"));
    symlinkSync(join(outside, "t.yaml"), disk(FILE));
    expect((await get()).text).toBe("");
    rmSync(outside, { recursive: true });
  });
});

describe("a layout.json override on a truncated pipeline", () => {
  test("names a job of the workflow that did not parse: a warning on every document", async () => {
    const root = mkdtempSync(join(tmpdir(), "keelson-truncated-"));
    const files = {
      ".github/workflows/a.yml":
        "on: push\njobs:\n  build:\n    runs-on: x\n    steps:\n      - run: make\n",
      ".github/workflows/b.yml": "on: push\njobs:\n  deploy: [\n",
      ".devsecops/layout.json": '{"version":1,"layers":{"deploy":["sast"]}}',
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const server = await createServer({ root, port: 0 });
    try {
      for (const name of ["a", "b"]) {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/api/documents/.github%2Fworkflows%2F${name}.yml`,
          { headers: { "x-keelson-token": server.token } },
        );
        const body = (await response.json()) as { diagnostics: { code: string }[] };
        const codes = body.diagnostics.map((entry) => entry.code);
        expect(codes).toContain("LAYOUT_UNREAD_JOB");
        expect(codes).not.toContain("LAYOUT_UNKNOWN_JOB");
      }
    } finally {
      await server.close();
      rmSync(root, { recursive: true });
    }
  });
});

describe("a toolchain job on a truncated pipeline", () => {
  const TOOLCHAIN =
    "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: deploy\n    service: n\n    kind: push\n";

  async function severities(files: Record<string, string>, path: string): Promise<string[]> {
    const root = mkdtempSync(join(tmpdir(), "keelson-truncated-"));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const server = await createServer({ root, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        headers: { "x-keelson-token": server.token },
      });
      const body = (await response.json()) as { diagnostics: { code: string; severity: string }[] };
      return body.diagnostics
        .filter((entry) => entry.code === "TOOLCHAIN_UNKNOWN_JOB")
        .map((entry) => entry.severity);
    } finally {
      await server.close();
      rmSync(root, { recursive: true });
    }
  }

  const truncated = {
    ".github/workflows/a.yml":
      "on: push\njobs:\n  build:\n    runs-on: x\n    steps:\n      - run: make\n",
    ".github/workflows/b.yml": "on: push\njobs:\n  deploy: [\n",
    ".devsecops/toolchain.yaml": TOOLCHAIN,
  };

  test("the toolchain API says warning, as keelson validate does", async () => {
    expect(await severities(truncated, "/api/toolchain")).toEqual(["warning"]);
  });

  test("the document that did not parse says the same", async () => {
    expect(await severities(truncated, "/api/documents/.github%2Fworkflows%2Fb.yml")).toEqual([
      "warning",
    ]);
  });

  test("so does a neighbour that parsed", async () => {
    expect(await severities(truncated, "/api/documents/.github%2Fworkflows%2Fa.yml")).toEqual([
      "warning",
    ]);
  });

  test("it stays an error when every file parsed", async () => {
    expect(
      await severities(
        { ".gitlab-ci.yml": MAIN, ".devsecops/toolchain.yaml": TOOLCHAIN },
        "/api/toolchain",
      ),
    ).toEqual(["error"]);
  });
});

describe("POST /api/toolchain/operations", () => {
  test("the first operation creates the directory and the file", async () => {
    const { status, body } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(200);
    expect(readFileSync(disk(FILE), "utf8")).toBe(body.text);
    expect(body.toolchain.services.map((entry) => entry.id)).toEqual(["harbor"]);
    expect(body.inverse).toBeDefined();
  });

  test("a replayed opId does not write twice", async () => {
    await post({ ...addHarbor, baseHash: hashText("") });
    const { status } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(200);
    expect(readFileSync(disk(FILE), "utf8").match(/harbor:/g)).toHaveLength(1);
  });

  test("a stale hash returns 409 with the current hash, without writing", async () => {
    write(FILE, TEXT);
    const { status, body } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(409);
    expect(body.code).toBe("STALE_DOCUMENT");
    expect(body.hash).toBe(hashText(TEXT));
    expect(readFileSync(disk(FILE), "utf8")).toBe(TEXT);
  });

  test("an invalid operation returns 400, a refusal 422", async () => {
    expect((await post({ kind: "inconnu", baseHash: hashText("") })).status).toBe(400);
    write(FILE, TEXT);
    const refused = await post(
      { kind: "removeService", id: "x", baseHash: hashText(TEXT) },
      "op-2",
    );
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("SERVICE_NOT_FOUND");
  });

  test("a .devsecops directory linked outside the root is not written", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-out-"));
    symlinkSync(outside, disk(".devsecops"));
    const { status, body } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(422);
    expect(body.code).toBe("INVALID_OPERATION");
    expect(existsSync(join(outside, "toolchain.yaml"))).toBe(false);
    rmSync(outside, { recursive: true });
  });
});

describe("PUT /api/layout/positions", () => {
  const put = (positions: unknown) =>
    harness.api("/api/layout/positions", {
      method: "PUT",
      body: JSON.stringify({ positions }),
    });

  test("writes layout.json and returns them on GET", async () => {
    expect((await put({ "service:nexus": { x: 1, y: 2 } })).status).toBe(200);
    expect((await get()).positions).toEqual({ "service:nexus": { x: 1, y: 2 } });
  });

  test("an invalid shape returns 400", async () => {
    expect((await put({ a: { x: "1" } })).status).toBe(400);
  });

  test("an unreadable layout.json is not overwritten", async () => {
    write(".devsecops/layout.json", "{");
    expect((await put({})).status).toBe(422);
    expect(readFileSync(disk(".devsecops/layout.json"), "utf8")).toBe("{");
  });

  test("requires the token, and PUT only", async () => {
    expect((await harness.raw("/api/layout/positions")).status).toBe(403);
    expect((await harness.api("/api/layout/positions")).status).toBe(405);
  });
});

describe("watcher", () => {
  test("an external write emits toolchain.changed with its hash", async () => {
    const events: DocumentEvent[] = [];
    const store = new DocumentStore(harness.root, detectWorkspace(harness.root));
    await store.load(".gitlab-ci.yml");
    const watcher = watchDocuments(harness.root, store, (event) => events.push(event));
    try {
      write(FILE, TEXT);
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline && !events.some((e) => e.kind === "toolchain.changed")) {
        await new Promise((settle) => setTimeout(settle, 25));
      }
      expect(events.find((e) => e.kind === "toolchain.changed")).toEqual({
        kind: "toolchain.changed",
        hash: hashText(TEXT),
      });
    } finally {
      watcher.close();
    }
  });
});

describe("what Keelson cannot read, it does not overwrite", () => {
  test("a toolchain.yaml without read permission is not replaced", async () => {
    write(FILE, TEXT);
    chmodSync(disk(FILE), 0o000);
    const body = await get();
    expect(body.diagnostics.map((entry) => entry.code)).toContain("TOOLCHAIN_INVALID");
    const { status } = await post({ ...addHarbor, baseHash: hashText("") });
    chmodSync(disk(FILE), 0o644);
    expect(status).toBe(422);
    expect(readFileSync(disk(FILE), "utf8")).toBe(TEXT);
  });

  test("a toolchain.yaml linked outside the root is not replaced", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-out-"));
    writeFileSync(join(outside, "t.yaml"), TEXT);
    mkdirSync(disk(".devsecops"));
    symlinkSync(join(outside, "t.yaml"), disk(FILE));
    const { status } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(422);
    expect(lstatSync(disk(FILE)).isSymbolicLink()).toBe(true);
    rmSync(outside, { recursive: true });
  });

  test("an internal link stays a link, its target receives the write", async () => {
    write("conf/toolchain.yaml", TEXT);
    mkdirSync(disk(".devsecops"));
    symlinkSync(disk("conf/toolchain.yaml"), disk(FILE));
    const { status } = await post({ ...addHarbor, baseHash: hashText(TEXT) });
    expect(status).toBe(200);
    expect(lstatSync(disk(FILE)).isSymbolicLink()).toBe(true);
    expect(readFileSync(disk("conf/toolchain.yaml"), "utf8")).toContain("harbor:");
  });

  test("a file that is not UTF-8 is not rewritten", async () => {
    const bytes = Buffer.concat([
      Buffer.from("# caf"),
      Buffer.from([0xe9]),
      Buffer.from("\nversion: 1\n"),
    ]);
    mkdirSync(disk(".devsecops"));
    writeFileSync(disk(FILE), bytes);
    const { status } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(422);
    expect(readFileSync(disk(FILE)).equals(bytes)).toBe(true);
  });

  test("a .devsecops that is a regular file refuses as the CLI does: not a directory", async () => {
    writeFileSync(disk(".devsecops"), "not a directory\n");
    const { status, body } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(422);
    expect(body).toEqual({
      code: "INVALID_OPERATION",
      params: { reason: "notADirectory", path: ".devsecops" },
    } as unknown as Body);
    expect(readFileSync(disk(".devsecops"), "utf8")).toBe("not a directory\n");
  });

  test("positions refuse the same way when .devsecops is a regular file", async () => {
    writeFileSync(disk(".devsecops"), "not a directory\n");
    const response = await harness.api("/api/layout/positions", {
      method: "PUT",
      body: JSON.stringify({ positions: { "job:a": { x: 1, y: 1 } } }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "INVALID_OPERATION",
      params: { reason: "notADirectory", path: ".devsecops" },
    });
    expect(readFileSync(disk(".devsecops"), "utf8")).toBe("not a directory\n");
  });

  test("a directory in place of the file refuses, without a 500", async () => {
    mkdirSync(disk(FILE), { recursive: true });
    const { status } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(422);
  });

  test("a layout.json without read permission is not replaced", async () => {
    const text = '{"version":1,"layers":{"a":["sast"]}}';
    write(".devsecops/layout.json", text);
    chmodSync(disk(".devsecops/layout.json"), 0o000);
    const response = await harness.api("/api/layout/positions", {
      method: "PUT",
      body: JSON.stringify({ positions: {} }),
    });
    chmodSync(disk(".devsecops/layout.json"), 0o644);
    expect(response.status).toBe(422);
    expect(readFileSync(disk(".devsecops/layout.json"), "utf8")).toBe(text);
  });

  test("positions merge: hand-written ones survive", async () => {
    write(".devsecops/layout.json", '{"version":1,"positions":{"human":{"x":1,"y":1}}}');
    const response = await harness.api("/api/layout/positions", {
      method: "PUT",
      body: JSON.stringify({ positions: { "job:a": { x: 2, y: 2 } } }),
    });
    expect(((await response.json()) as Body).positions).toEqual({
      human: { x: 1, y: 1 },
      "job:a": { x: 2, y: 2 },
    });
  });
});

describe("request body", () => {
  test.each([
    ["POST", "/api/toolchain/operations"],
    ["PUT", "/api/layout/positions"],
    ["POST", "/api/documents/.gitlab-ci.yml/operations"],
  ])("%s %s with a null body returns 400", async (method, path) => {
    const response = await harness.api(path, { method, body: "null" });
    expect(response.status).toBe(400);
  });
});
