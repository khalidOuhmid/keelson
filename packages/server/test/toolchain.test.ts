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
  test("sans fichier : une toolchain vide et le hash du texte vide", async () => {
    const body = await get();
    expect(body.text).toBe("");
    expect(body.hash).toBe(hashText(""));
    expect(body.toolchain.services).toEqual([]);
    expect(existsSync(disk(FILE))).toBe(false);
  });

  test("rend les propositions et les diagnostics du pipeline courant", async () => {
    write(FILE, `${TEXT}integrations:\n  - job: fantome\n    service: nexus\n    kind: push\n`);
    const body = await get();
    expect(body.diagnostics.map((entry) => entry.code)).toEqual(["TOOLCHAIN_UNKNOWN_JOB"]);
    expect(body.proposed.map((entry) => entry.tool)).toEqual(["nexus"]);
  });

  test("les diagnostics de la toolchain arrivent aussi avec le document", async () => {
    write(FILE, "version: 2\n");
    const response = await harness.api("/api/documents/.gitlab-ci.yml");
    const body = (await response.json()) as Body;
    expect(body.diagnostics.map((entry) => entry.code)).toContain("TOOLCHAIN_INVALID");
  });

  test("un service déclaré compte dans la couverture du document", async () => {
    write(FILE, TEXT);
    const body = (await (await harness.api("/api/documents/.gitlab-ci.yml")).json()) as {
      coverage: { layers: { layer: string; services: string[] }[] };
    };
    const registry = body.coverage.layers.find((entry) => entry.layer === "registry");
    expect(registry?.services).toEqual(["nexus"]);
  });

  test("un lien sorti de la racine se lit comme un fichier absent", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-out-"));
    writeFileSync(join(outside, "t.yaml"), TEXT);
    mkdirSync(disk(".devsecops"));
    symlinkSync(join(outside, "t.yaml"), disk(FILE));
    expect((await get()).text).toBe("");
    rmSync(outside, { recursive: true });
  });
});

describe("POST /api/toolchain/operations", () => {
  test("la première opération crée le dossier et le fichier", async () => {
    const { status, body } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(200);
    expect(readFileSync(disk(FILE), "utf8")).toBe(body.text);
    expect(body.toolchain.services.map((entry) => entry.id)).toEqual(["harbor"]);
    expect(body.inverse).toBeDefined();
  });

  test("un opId rejoué n'écrit pas deux fois", async () => {
    await post({ ...addHarbor, baseHash: hashText("") });
    const { status } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(200);
    expect(readFileSync(disk(FILE), "utf8").match(/harbor:/g)).toHaveLength(1);
  });

  test("un hash périmé rend 409 avec le hash courant, sans écrire", async () => {
    write(FILE, TEXT);
    const { status, body } = await post({ ...addHarbor, baseHash: hashText("") });
    expect(status).toBe(409);
    expect(body.code).toBe("STALE_DOCUMENT");
    expect(body.hash).toBe(hashText(TEXT));
    expect(readFileSync(disk(FILE), "utf8")).toBe(TEXT);
  });

  test("une opération invalide rend 400, un refus 422", async () => {
    expect((await post({ kind: "inconnu", baseHash: hashText("") })).status).toBe(400);
    write(FILE, TEXT);
    const refused = await post(
      { kind: "removeService", id: "x", baseHash: hashText(TEXT) },
      "op-2",
    );
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("SERVICE_NOT_FOUND");
  });

  test("un dossier .devsecops lié hors de la racine n'est pas écrit", async () => {
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

  test("écrit layout.json et les rend au GET", async () => {
    expect((await put({ "service:nexus": { x: 1, y: 2 } })).status).toBe(200);
    expect((await get()).positions).toEqual({ "service:nexus": { x: 1, y: 2 } });
  });

  test("une forme invalide rend 400", async () => {
    expect((await put({ a: { x: "1" } })).status).toBe(400);
  });

  test("un layout.json illisible n'est pas écrasé", async () => {
    write(".devsecops/layout.json", "{");
    expect((await put({})).status).toBe(422);
    expect(readFileSync(disk(".devsecops/layout.json"), "utf8")).toBe("{");
  });

  test("exige le token, et PUT seulement", async () => {
    expect((await harness.raw("/api/layout/positions")).status).toBe(403);
    expect((await harness.api("/api/layout/positions")).status).toBe(405);
  });
});

describe("watcher", () => {
  test("une écriture externe émet toolchain.changed avec son hash", async () => {
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
