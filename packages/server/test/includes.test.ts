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
  throw new Error("aucun événement reçu");
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

describe("chargement d'un document à includes", () => {
  test("le pipeline contient les jobs des fichiers inclus", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.pipeline.jobs.map((job) => job.id).sort()).toEqual(["compile", "unit"]);
  });

  /** Sans les textes des fichiers inclus sur le fil, l'UI découperait les plages des blocs opaques
   *  d'un job inclus dans le texte du fichier principal : des octets pris ailleurs, affichés sous
   *  la seule promesse « ceci est verbatim ». */
  test("la charge porte le texte de chaque fichier inclus", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.included).toEqual({ "ci/jobs.yml": INCLUDED });
  });

  test("un need vers un job inclus n'est plus un UNKNOWN_NEED", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.diagnostics.map((entry) => entry.code)).toEqual([]);
  });

  test("le store expose les fichiers inclus du document", async () => {
    await store.load(".gitlab-ci.yml");
    expect(store.includedFiles(".gitlab-ci.yml")).toEqual(["ci/jobs.yml"]);
  });
});

describe("un lien symbolique qui sort de la racine", () => {
  /** La conséquence réelle du défaut trouvé par la revue de L2b n'est pas qu'un `read()` rende une
   *  valeur : c'est que le contenu d'un fichier arbitraire parte dans la charge envoyée au
   *  navigateur. `reader.test.ts` garde le lecteur, ce test garde la charge. */
  test("son contenu n'entre pas dans la charge du document", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-srv-dehors-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "SECRET-HORS-DEPOT\n");
      symlinkSync(join(outside, "secret.txt"), join(root, "ci", "fuite.yml"));
      write(".gitlab-ci.yml", MAIN.replace("/ci/jobs.yml", "/ci/fuite.yml"));

      const loaded = await store.load(".gitlab-ci.yml");

      expect(JSON.stringify(loaded)).not.toContain("SECRET-HORS-DEPOT");
      expect(loaded?.included).toEqual({});
      expect(loaded?.diagnostics.map((entry) => entry.code)).toContain("INCLUDE_NOT_FOUND");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("un fichier principal lié hors de la racine", () => {
  /** Le fichier principal ne passait pas par le lecteur : `.gitlab-ci.yml` lié vers n'importe quel
   *  fichier partait tel quel dans la charge, sans même de contrôle d'extension. Même scénario que
   *  le lien inclus, par la seule voie que le correctif de L2b n'avait pas fermée. */
  function linkMainOutside(): string {
    const outside = mkdtempSync(join(tmpdir(), "keelson-srv-main-"));
    writeFileSync(join(outside, "s.yml"), "SECRET_KEY: HORS-RACINE\n");
    rmSync(join(root, ".gitlab-ci.yml"));
    symlinkSync(join(outside, "s.yml"), join(root, ".gitlab-ci.yml"));
    return outside;
  }

  test("il n'est pas détecté comme fichier de l'espace de travail", () => {
    const outside = linkMainOutside();
    try {
      expect(detectWorkspace(root)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("le store ne le charge pas, même si la liste le nomme", async () => {
    const outside = linkMainOutside();
    try {
      const forced = new DocumentStore(root, [{ path: ".gitlab-ci.yml", adapter: "gitlab" }]);
      expect(await forced.load(".gitlab-ci.yml")).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("écriture bornée au fichier principal", () => {
  test("une opération sur un job inclus est refusée en 422", async () => {
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

  /** La garantie du produit, mesurée sur le disque et non sur l'intention : le fichier inclus doit
   *  être **octet pour octet** celui d'avant, après une opération acceptée. */
  test("une opération acceptée ne réécrit pas le fichier inclus", async () => {
    await store.load(".gitlab-ci.yml");
    const response = await store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
        kind: "addStage",
        name: "livrer",
      },
      "op-2",
    );

    expect(response.status).toBe(200);
    expect(readFileSync(join(root, "ci/jobs.yml"), "utf8")).toBe(INCLUDED);
  });

  /** `resolveWorkspaceFile` ne connaît que le fichier détecté. Un fichier inclus n'entre donc
   *  jamais dans la liste blanche d'écriture, même si le client en demande le nom. */
  test("un fichier inclus n'est pas adressable comme document", async () => {
    expect(await store.load("ci/jobs.yml")).toBeNull();
  });
});

describe("surveillance des fichiers inclus", () => {
  test("modifier un fichier inclus émet document.changed sur le fichier principal", async () => {
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

  /** Le piège que le hook `onLoaded` évite : le watcher est construit **avant** tout chargement,
   *  donc `includedFiles` est vide à ce moment-là. Sans abonnement au chargement, le dossier de
   *  `ci/` ne serait surveillé qu'après un premier changement — c'est-à-dire que le premier
   *  changement serait toujours manqué. */
  test("le fichier inclus est surveillé même si le watcher démarre avant tout chargement", async () => {
    watcher = watchDocuments(root, store, (event) => events.push(event));
    await store.load(".gitlab-ci.yml");

    write("ci/jobs.yml", `${INCLUDED}\ntardif:\n  stage: build\n  script:\n    - make\n`);

    const event = await waitForEvent();
    expect(event.kind === "document.changed" ? event.file : "").toBe(".gitlab-ci.yml");
  });

  /** Le store purge le document, donc l'écran doit l'apprendre : sinon il reste sur un pipeline qui
   *  n'existe plus, jusqu'au 404 de la prochaine opération. */
  test("un fichier principal remplacé par un lien refusé émet document.removed", async () => {
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    const outside = mkdtempSync(join(tmpdir(), "keelson-srv-devenu-"));
    try {
      writeFileSync(join(outside, "s.yml"), "SECRET_KEY: HORS-RACINE\n");
      rmSync(join(root, ".gitlab-ci.yml"));
      symlinkSync(join(outside, "s.yml"), join(root, ".gitlab-ci.yml"));

      const event = await waitForEvent();
      expect(event).toEqual({ kind: "document.removed", file: ".gitlab-ci.yml" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("un include ajouté après coup entre dans la surveillance", async () => {
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

  test("un fichier hors de l'arbre résolu n'émet rien", async () => {
    await store.load(".gitlab-ci.yml");
    watcher = watchDocuments(root, store, (event) => events.push(event));

    write("ci/jamais-inclus.yml", "rien:\n  stage: build\n  script:\n    - make\n");
    await settle(300);
    expect(events).toEqual([]);
  });
});
