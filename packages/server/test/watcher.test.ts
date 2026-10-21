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
  throw new Error(`aucun événement « ${kind} » reçu ; reçus : ${JSON.stringify(events)}`);
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

describe("modification externe", () => {
  test("une écriture extérieure émet document.changed avec le nouveau hash", async () => {
    writeFileSync(path(), `${BASE}\nautre:\n  stage: build\n  script:\n    - echo\n`);
    const event = await waitForEvent("document.changed");
    expect(event.file).toBe(".gitlab-ci.yml");
    expect(event.kind).toBe("document.changed");
    if (event.kind === "document.changed") {
      expect(event.hash).toBe(store.currentHash(".gitlab-ci.yml"));
    }
  });

  test("le store est rechargé après une modification externe", async () => {
    writeFileSync(path(), `${BASE}\nautre:\n  stage: build\n  script:\n    - echo\n`);
    await waitForEvent("document.changed");
    expect(store.currentText(".gitlab-ci.yml")).toContain("autre:");
  });

  test("un remplacement par rename est détecté", async () => {
    const temporary = join(root, "remplacant.tmp");
    writeFileSync(temporary, `${BASE}\nremplace:\n  stage: build\n  script:\n    - echo\n`);
    renameSync(temporary, path());
    await waitForEvent("document.changed");
    expect(store.currentText(".gitlab-ci.yml")).toContain("remplace:");
  });

  test("la suppression du fichier émet document.removed", async () => {
    rmSync(path());
    const event = await waitForEvent("document.removed");
    expect(event.file).toBe(".gitlab-ci.yml");
  });
});

describe("écritures propres du serveur", () => {
  test("une opération appliquée par le serveur n'émet pas document.changed", async () => {
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

  test("une réécriture du même contenu n'émet rien", async () => {
    writeFileSync(path(), BASE);
    await settle(400);
    expect(events).toEqual([]);
  });

  test("une modification externe après une écriture propre est bien détectée", async () => {
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

describe("cycle de vie", () => {
  test("close arrête l'émission d'événements", async () => {
    watcher?.close();
    watcher = undefined;
    writeFileSync(path(), `${BASE}\napres:\n  stage: build\n  script:\n    - echo\n`);
    await settle(400);
    expect(events).toEqual([]);
  });

  test("close est idempotent", () => {
    expect(() => {
      watcher?.close();
      watcher?.close();
    }).not.toThrow();
  });

  test("le watcher surveille le dossier, pas seulement le fichier", async () => {
    rmSync(path());
    await waitForEvent("document.removed");
    events = [];

    writeFileSync(path(), `${BASE}\nrecree:\n  stage: build\n  script:\n    - echo\n`);
    const event = await waitForEvent("document.changed");
    expect(event.kind).toBe("document.changed");
    expect(store.currentText(".gitlab-ci.yml")).toContain("recree:");
  });

  test("un autre fichier du dossier est ignoré", async () => {
    writeFileSync(join(root, "sans-rapport.txt"), "bruit\n");
    await settle(400);
    expect(events).toEqual([]);
  });
});
