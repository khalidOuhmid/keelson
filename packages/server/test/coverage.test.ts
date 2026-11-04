import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

describe("couverture dans la charge", () => {
  test("au chargement", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded === null ? null : layer(loaded, "secrets")).toBe(true);
    expect(loaded === null ? null : layer(loaded, "dast")).toBe(false);
  });

  test("après une opération, recalculée sur le nouveau pipeline", async () => {
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

  test("une surcharge de layout.json s'applique et ses diagnostics arrivent", async () => {
    writeLayout('{"version":1,"layers":{"secrets":["iast"],"absent":[]}}');
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded === null ? null : layer(loaded, "iast")).toBe(true);
    expect(loaded?.diagnostics.map((entry) => entry.code)).toEqual(["LAYOUT_UNKNOWN_JOB"]);
  });

  /** `JSON.parse` cite le texte lu dans son message : sans la frontière, le contenu d'un fichier
   *  extérieur sortirait par le `detail` d'un diagnostic. */
  test("un layout.json lié hors de la racine n'est pas lu", async () => {
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

describe("surveillance de layout.json", () => {
  async function waitForEvent(events: DocumentEvent[]): Promise<DocumentEvent> {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const found = events[0];
      if (found !== undefined) {
        return found;
      }
      await new Promise((settle) => setTimeout(settle, 25));
    }
    throw new Error("aucun événement reçu");
  }

  test("le créer alors que .devsecops n'existe pas met la couverture à jour", async () => {
    const events: DocumentEvent[] = [];
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    writeLayout('{"version":1,"layers":{"secrets":["iast"]}}');

    expect((await waitForEvent(events)).kind).toBe("coverage.changed");
    expect(events[0]).toEqual({ kind: "coverage.changed", file: ".gitlab-ci.yml" });
  });

  test("supprimer puis recréer le dossier garde la surveillance", async () => {
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

  test("le modifier ensuite émet coverage.changed", async () => {
    writeLayout('{"version":1}');
    const events: DocumentEvent[] = [];
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    writeLayout('{"version":1,"layers":{"secrets":["iast"]}}');
    expect((await waitForEvent(events)).kind).toBe("coverage.changed");
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

  test("rend les couches, les outils et les logos", async () => {
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

  test("exige le token, et GET seulement", async () => {
    expect((await harness.raw("/api/catalog")).status).toBe(403);
    expect((await harness.api("/api/catalog", { method: "POST" })).status).toBe(405);
  });
});
