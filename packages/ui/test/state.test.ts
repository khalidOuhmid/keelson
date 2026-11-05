import { beforeEach, describe, expect, test } from "bun:test";
import type { Coverage } from "@keelson/catalog";
import type { Operation, Pipeline } from "@keelson/core";
import type { ApiResult, DocumentPayload, OperationPayload } from "../src/api/client.ts";
import { createStore, type KeelsonStore } from "../src/state/store.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

const MAIN = ".gitlab-ci.yml";

const NO_COVERAGE: Coverage = { jobs: [], layers: [], partial: false };

function pipeline(jobs: string[] = ["compile"]): Pipeline {
  return {
    stages: [{ name: "build", implicit: false, range: { start: 0, end: 5 }, file: MAIN }],
    jobs: jobs.map((id) => ({
      id,
      stage: { value: "build", origin: { kind: "local" } },
      needs: null,
      environment: null,
      extends: [],
      opaque: [],
      signals: { image: null, script: [] },
      range: { start: 0, end: 10 },
      file: MAIN,
    })),
    templates: [],
    opaque: [],
    main: MAIN,
    files: [MAIN],
    unresolved: [],
  };
}

function documentPayload(hash = HASH_A): DocumentPayload {
  return {
    text: "stages:\n  - build\n",
    pipeline: pipeline(),
    diagnostics: [],
    hash,
    included: {},
    coverage: NO_COVERAGE,
  };
}

function operationPayload(hash: string, inverseHash: string): OperationPayload {
  return {
    text: "stages:\n  - build\n",
    pipeline: pipeline(["compile", "unit"]),
    diagnostics: [],
    hash,
    included: {},
    coverage: NO_COVERAGE,
    inverse: {
      v: 1,
      baseHash: inverseHash,
      kind: "splice",
      start: 0,
      end: 0,
      text: "",
    },
    touched: [{ start: 0, end: 0 }],
  };
}

type Call = { op: Operation; opId: string };

class FakeApi {
  readonly calls: Call[] = [];
  private responses: ApiResult<OperationPayload>[] = [];
  private documents: ApiResult<DocumentPayload>[] = [];

  queue(response: ApiResult<OperationPayload>): void {
    this.responses.push(response);
  }

  queueDocument(response: ApiResult<DocumentPayload>): void {
    this.documents.push(response);
  }

  submit = async (
    _file: string,
    op: Operation,
    opId: string,
  ): Promise<ApiResult<OperationPayload>> => {
    this.calls.push({ op, opId });
    return (
      this.responses.shift() ?? {
        ok: true,
        value: operationPayload(HASH_B, HASH_B),
      }
    );
  };

  document: () => Promise<ApiResult<DocumentPayload>> = async () =>
    this.documents.shift() ?? { ok: true, value: documentPayload(HASH_C) };
}

let api: FakeApi;
let store: KeelsonStore;

function state() {
  return store.getState();
}

async function addStage(name: string): Promise<void> {
  await state().submit({ kind: "addStage", name });
}

beforeEach(() => {
  api = new FakeApi();
  store = createStore({
    submit: api.submit,
    document: api.document,
    catalog: async () => ({ ok: true, value: { layers: [], tools: [], logos: {} } }),
    newOpId: (() => {
      let counter = 0;
      return () => {
        counter += 1;
        return `op-${counter}`;
      };
    })(),
  });
  state().documentLoaded(".gitlab-ci.yml", documentPayload());
});

describe("chargement", () => {
  test("le document chargé devient l'état courant", () => {
    expect(state().file).toBe(".gitlab-ci.yml");
    expect(state().hash).toBe(HASH_A);
    expect(state().pipeline?.jobs).toHaveLength(1);
    expect(state().status).toBe("ready");
  });

  test("les piles sont vides au chargement", () => {
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
  });
});

describe("envoi d'opérations", () => {
  test("l'opération est envoyée avec le hash courant et un opId", async () => {
    await addStage("verify");
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.op.baseHash).toBe(HASH_A);
    expect(api.calls[0]?.op.v).toBe(1);
    expect(api.calls[0]?.opId).toBe("op-1");
  });

  test("chaque opération porte un opId distinct", async () => {
    await addStage("verify");
    await addStage("publish");
    expect(api.calls[0]?.opId).not.toBe(api.calls[1]?.opId);
  });

  test("le succès met à jour pipeline et hash", async () => {
    await addStage("verify");
    expect(state().hash).toBe(HASH_B);
    expect(state().pipeline?.jobs).toHaveLength(2);
    expect(state().error).toBeNull();
  });

  test("le succès empile un inverse annulable", async () => {
    await addStage("verify");
    expect(state().canUndo()).toBe(true);
    expect(state().canRedo()).toBe(false);
  });
});

describe("undo et redo", () => {
  test("undo renvoie l'inverse au serveur", async () => {
    await addStage("verify");
    await state().undo();
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]?.op.kind).toBe("splice");
  });

  test("après undo, redo devient possible", async () => {
    await addStage("verify");
    await state().undo();
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(true);
  });

  test("redo rejoue l'opération d'origine", async () => {
    await addStage("verify");
    await state().undo();
    await state().redo();
    expect(api.calls).toHaveLength(3);
    expect(api.calls[2]?.op.kind).toBe("addStage");
  });

  test("undo sans rien à annuler ne fait aucun appel", async () => {
    await state().undo();
    expect(api.calls).toEqual([]);
  });

  test("redo sans rien à rétablir ne fait aucun appel", async () => {
    await state().redo();
    expect(api.calls).toEqual([]);
  });

  test("une nouvelle opération vide la pile de redo", async () => {
    await addStage("verify");
    await state().undo();
    expect(state().canRedo()).toBe(true);
    await addStage("publish");
    expect(state().canRedo()).toBe(false);
  });

  test("l'inverse envoyé porte le hash courant au moment de l'annulation", async () => {
    await addStage("verify");
    await state().undo();
    expect(api.calls[1]?.op.baseHash).toBe(HASH_B);
  });

  test("deux opérations s'annulent dans l'ordre inverse", async () => {
    await addStage("un");
    await addStage("deux");
    await state().undo();
    await state().undo();
    expect(state().canUndo()).toBe(false);
    expect(api.calls.map((call) => call.op.kind)).toEqual([
      "addStage",
      "addStage",
      "splice",
      "splice",
    ]);
  });
});

describe("erreurs", () => {
  test("une erreur métier est exposée telle quelle sans vider les piles", async () => {
    await addStage("verify");
    api.queue({
      ok: false,
      error: {
        status: 422,
        code: "JOB_REFERENCED",
        params: { job: "compile", referencedBy: ["unit"] },
      },
    });
    await addStage("publish");

    expect(state().error?.code).toBe("JOB_REFERENCED");
    expect(state().error?.params).toEqual({ job: "compile", referencedBy: ["unit"] });
    expect(state().canUndo()).toBe(true);
  });

  test("une erreur n'avance pas le hash", async () => {
    api.queue({
      ok: false,
      error: { status: 422, code: "STAGE_EXISTS", params: { stage: "verify" } },
    });
    await addStage("verify");
    expect(state().hash).toBe(HASH_A);
  });

  test("une erreur n'empile pas d'inverse", async () => {
    api.queue({
      ok: false,
      error: { status: 400, code: "INVALID_OPERATION", params: { reason: "missingOp" } },
    });
    await addStage("verify");
    expect(state().canUndo()).toBe(false);
  });

  test("l'erreur est effacée par l'opération suivante réussie", async () => {
    api.queue({
      ok: false,
      error: { status: 422, code: "STAGE_EXISTS", params: { stage: "verify" } },
    });
    await addStage("verify");
    expect(state().error).not.toBeNull();
    await addStage("publish");
    expect(state().error).toBeNull();
  });
});

describe("409 : le fichier a changé sur disque", () => {
  test("recharge le document et vide les deux piles", async () => {
    await addStage("verify");
    await state().undo();
    expect(state().canRedo()).toBe(true);

    api.queue({
      ok: false,
      error: {
        status: 409,
        code: "STALE_DOCUMENT",
        params: { expected: HASH_C, received: HASH_A },
        hash: HASH_C,
      },
    });
    await addStage("publish");

    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
    expect(state().hash).toBe(HASH_C);
  });

  test("informe que le fichier a changé et que l'opération n'a pas été appliquée", async () => {
    api.queue({
      ok: false,
      error: {
        status: 409,
        code: "STALE_DOCUMENT",
        params: { expected: HASH_C, received: HASH_A },
        hash: HASH_C,
      },
    });
    await addStage("verify");
    expect(state().notice?.kind).toBe("stale");
  });
});

describe("événements du serveur", () => {
  test("document.changed recharge et vide les piles", async () => {
    await addStage("verify");
    expect(state().canUndo()).toBe(true);

    await state().serverEvent({ kind: "document.changed", file: ".gitlab-ci.yml", hash: HASH_C });

    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
    expect(state().hash).toBe(HASH_C);
    expect(state().notice?.kind).toBe("reloaded");
  });

  test("document.removed vide les piles et marque le document absent", async () => {
    await addStage("verify");
    await state().serverEvent({ kind: "document.removed", file: ".gitlab-ci.yml" });

    expect(state().status).toBe("removed");
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
  });

  test("un événement sur un autre fichier est ignoré", async () => {
    await addStage("verify");
    await state().serverEvent({ kind: "document.removed", file: "autre.yml" });
    expect(state().status).toBe("ready");
    expect(state().canUndo()).toBe(true);
  });
});

describe("coverage.changed", () => {
  test("une réponse rendue périmée par une opération ne remplace pas la couverture", async () => {
    let answer: (result: { ok: true; value: DocumentPayload }) => void = () => {};
    const pending = new Promise<{ ok: true; value: DocumentPayload }>((settle) => {
      answer = settle;
    });
    const late = createStore({
      submit: api.submit,
      document: () => pending,
      catalog: async () => ({ ok: true, value: { layers: [], tools: [], logos: {} } }),
      newOpId: () => "op",
    });
    late.getState().documentLoaded(MAIN, documentPayload(HASH_A));
    const handled = late.getState().serverEvent({ kind: "coverage.changed", file: MAIN });
    late.getState().documentLoaded(MAIN, {
      ...documentPayload(HASH_B),
      coverage: { ...NO_COVERAGE, partial: true },
    });

    answer({ ok: true, value: documentPayload(HASH_A) });
    await handled;

    expect(late.getState().coverage?.partial).toBe(true);
  });
});

describe("coverage.changed sur un client en retard", () => {
  test("le document est rechargé : aucun événement ne suivra", async () => {
    api.queueDocument({ ok: true, value: documentPayload(HASH_B) });
    api.queueDocument({ ok: true, value: documentPayload(HASH_B) });
    await state().serverEvent({ kind: "coverage.changed", file: MAIN });
    expect(state().hash).toBe(HASH_B);
  });
});

describe("coverage.changed pendant une opération", () => {
  function held() {
    let settle: (result: ApiResult<OperationPayload>) => void = () => {};
    const promise = new Promise<ApiResult<OperationPayload>>((resolve) => {
      settle = resolve;
    });
    store = createStore({
      submit: () => promise,
      document: api.document,
      catalog: async () => ({ ok: true, value: { layers: [], tools: [], logos: {} } }),
      newOpId: () => "op",
    });
    state().documentLoaded(MAIN, documentPayload());
    return settle;
  }

  test("le fichier déjà écrit par cette opération ne passe pas pour une modification", async () => {
    const settle = held();
    const submitted = addStage("verify");
    api.queueDocument({ ok: true, value: documentPayload(HASH_B) });
    await state().serverEvent({ kind: "coverage.changed", file: MAIN });
    expect(state().notice).toBeNull();

    settle({ ok: true, value: operationPayload(HASH_B, HASH_A) });
    await submitted;
    expect(state().notice).toBeNull();
    expect(state().canUndo()).toBe(true);
  });

  test("une opération qui échoue sans 409 laisse le rechargement dû se faire", async () => {
    const settle = held();
    const submitted = addStage("verify");
    api.queueDocument({ ok: true, value: documentPayload(HASH_C) });
    await state().serverEvent({ kind: "coverage.changed", file: MAIN });
    expect(state().hash).toBe(HASH_A);

    api.queueDocument({ ok: true, value: documentPayload(HASH_C) });
    const error = { status: 500, code: "INTERNAL_ERROR", params: {} } as const;
    settle({ ok: false, error });
    await submitted;

    expect(state().hash).toBe(HASH_C);
    expect(state().error).toEqual(error);
  });

  test("une couverture au hash déjà atteint s'applique", async () => {
    let answer: (result: ApiResult<DocumentPayload>) => void = () => {};
    api.document = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const late = createStore({
      submit: () => Promise.resolve({ ok: true, value: operationPayload(HASH_B, HASH_A) }),
      document: api.document,
      catalog: async () => ({ ok: true, value: { layers: [], tools: [], logos: {} } }),
      newOpId: () => "op",
    });
    late.getState().documentLoaded(MAIN, documentPayload());
    const handled = late.getState().serverEvent({ kind: "coverage.changed", file: MAIN });
    await late.getState().submit({ kind: "addStage", name: "verify" });
    answer({
      ok: true,
      value: { ...documentPayload(HASH_B), coverage: { ...NO_COVERAGE, partial: true } },
    });
    await handled;
    expect(late.getState().coverage?.partial).toBe(true);
  });
});

describe("sélection", () => {
  test("un job peut être sélectionné puis désélectionné", () => {
    state().selectJob("compile");
    expect(state().selectedJobId).toBe("compile");
    state().selectJob(null);
    expect(state().selectedJobId).toBeNull();
  });

  test("sélectionner depuis un diagnostic sélectionne le job de la plage", () => {
    state().selectByRange(MAIN, { start: 0, end: 10 });
    expect(state().selectedJobId).toBe("compile");
  });

  test("une plage hors de tout job ne sélectionne rien", () => {
    state().selectJob("compile");
    state().selectByRange(MAIN, { start: 9000, end: 9001 });
    expect(state().selectedJobId).toBeNull();
  });

  test("la sélection d'un job disparu est abandonnée au rechargement", async () => {
    state().selectJob("compile");
    api.queueDocument({
      ok: true,
      value: { ...documentPayload(HASH_C), pipeline: pipeline(["autre"]) },
    });
    await state().serverEvent({ kind: "document.changed", file: ".gitlab-ci.yml", hash: HASH_C });
    expect(state().selectedJobId).toBeNull();
  });
});

describe("édition désactivée", () => {
  test("l'édition est désactivée quand un diagnostic d'erreur est présent", () => {
    state().documentLoaded(".gitlab-ci.yml", {
      ...documentPayload(),
      diagnostics: [
        {
          code: "INVALID_YAML",
          severity: "error",
          params: { detail: "broken" },
          range: null,
          file: MAIN,
        },
      ],
    });
    expect(state().canEdit()).toBe(false);
  });

  test("une erreur de validation ne désactive pas l'édition : il faut pouvoir la corriger", () => {
    state().documentLoaded(".gitlab-ci.yml", {
      ...documentPayload(),
      diagnostics: [
        {
          code: "UNKNOWN_NEED",
          severity: "error",
          params: { job: "unit", need: "absent" },
          range: { start: 0, end: 5 },
          file: MAIN,
        },
      ],
    });
    expect(state().canEdit()).toBe(true);
  });

  test("seul un YAML illisible désactive l'édition", () => {
    state().documentLoaded(".gitlab-ci.yml", {
      ...documentPayload(),
      diagnostics: [
        {
          code: "INVALID_YAML",
          severity: "error",
          params: { detail: "broken" },
          range: null,
          file: MAIN,
        },
        {
          code: "UNKNOWN_NEED",
          severity: "error",
          params: { job: "unit", need: "absent" },
          range: { start: 0, end: 5 },
          file: MAIN,
        },
      ],
    });
    expect(state().canEdit()).toBe(false);
  });

  test("un avertissement ne désactive pas l'édition", () => {
    state().documentLoaded(".gitlab-ci.yml", {
      ...documentPayload(),
      diagnostics: [
        {
          code: "JOB_WITHOUT_SCRIPT",
          severity: "warning",
          params: { job: "muet" },
          range: null,
          file: MAIN,
        },
      ],
    });
    expect(state().canEdit()).toBe(true);
  });

  test("l'édition est désactivée quand le document est supprimé", async () => {
    await state().serverEvent({ kind: "document.removed", file: ".gitlab-ci.yml" });
    expect(state().canEdit()).toBe(false);
  });

  test("aucune opération n'est envoyée quand l'édition est désactivée", async () => {
    await state().serverEvent({ kind: "document.removed", file: ".gitlab-ci.yml" });
    await addStage("verify");
    expect(api.calls).toEqual([]);
  });
});

describe("fermeture des bannières", () => {
  /** Trouvé par /impeccable critique le 2026-10-22 : le bouton Dismiss de la bannière d'erreur
   *  était câblé sur dismissNotice(), qui ne touche jamais `error`. La bannière était infermable. */
  test("dismissError efface l'erreur sans toucher à l'avis", async () => {
    api.queue({
      ok: false,
      error: {
        status: 409,
        code: "STALE_DOCUMENT",
        params: { expected: HASH_C, received: HASH_A },
        hash: HASH_C,
      },
    });
    await addStage("verify");

    expect(state().error).not.toBeNull();
    expect(state().notice).not.toBeNull();

    state().dismissError();

    expect(state().error).toBeNull();
    expect(state().notice).not.toBeNull();
  });

  test("dismissNotice efface l'avis sans toucher à l'erreur", async () => {
    api.queue({
      ok: false,
      error: {
        status: 409,
        code: "STALE_DOCUMENT",
        params: { expected: HASH_C, received: HASH_A },
        hash: HASH_C,
      },
    });
    await addStage("verify");

    state().dismissNotice();

    expect(state().notice).toBeNull();
    expect(state().error).not.toBeNull();
  });
});

describe("409 : l'erreur du serveur survit au rechargement", () => {
  /** Le brief déclare « operation rejected (server message shown verbatim) » load-bearing. `send`
   *  posait `error` puis appelait `reload`, qui le remettait à `null` : seul l'avis générique
   *  survivait et le message du serveur était perdu. */
  test("le code et le message du serveur restent affichables après le 409", async () => {
    api.queue({
      ok: false,
      error: {
        status: 409,
        code: "STALE_DOCUMENT",
        params: { expected: HASH_C, received: HASH_A },
        hash: HASH_C,
      },
    });
    await addStage("verify");

    expect(state().error).toEqual({
      status: 409,
      code: "STALE_DOCUMENT",
      params: { expected: HASH_C, received: HASH_A },
      hash: HASH_C,
    });
    expect(state().notice?.kind).toBe("stale");
    expect(state().hash).toBe(HASH_C);
  });
});

describe("le texte suit les opérations", () => {
  /** Trouvé par la revue indépendante du 2026-10-22 : `applyPayload` rafraîchissait `pipeline`,
   *  `diagnostics` et `hash`, jamais `text`. Les plages des blocs opaques viennent du nouveau
   *  pipeline, le texte restait celui du dernier chargement complet, et toute opération décalant des
   *  offsets désalignait les deux. Le watcher supprimant `document.changed` pour les écritures
   *  propres du serveur, aucun rechargement ne réparait jamais `text`. */
  test("une opération réussie remplace le texte du document", async () => {
    expect(state().text).toBe("stages:\n  - build\n");

    api.queue({
      ok: true,
      value: { ...operationPayload(HASH_B, HASH_B), text: "stages:\n  - build\n  - verify\n" },
    });
    await addStage("verify");

    expect(state().text).toBe("stages:\n  - build\n  - verify\n");
    expect(state().hash).toBe(HASH_B);
  });

  test("une annulation remet le texte d'avant", async () => {
    api.queue({
      ok: true,
      value: { ...operationPayload(HASH_B, HASH_B), text: "après" },
    });
    await addStage("verify");
    expect(state().text).toBe("après");

    api.queue({
      ok: true,
      value: { ...operationPayload(HASH_C, HASH_C), text: "stages:\n  - build\n" },
    });
    await state().undo();

    expect(state().text).toBe("stages:\n  - build\n");
  });
});

describe("sélection par plage avec plusieurs fichiers", () => {
  /** Deux fichiers ont chacun leurs offsets à partir de zéro. Sans le fichier dans la clé, la
   *  plage d'un diagnostic venu d'un fichier inclus tombe dans la plage d'un job du fichier
   *  principal, et l'écran sélectionne un job qui n'a rien à voir avec le message lu. */
  test("une plage venue d'un autre fichier ne sélectionne pas un job du fichier principal", () => {
    state().documentLoaded(MAIN, {
      text: "stages:\n  - build\n",
      pipeline: pipeline(),
      diagnostics: [],
      hash: HASH_A,
      included: { "ci/jobs.yml": "compile:\n" },
      coverage: NO_COVERAGE,
    });

    // `compile` occupe [0, 10[ dans le fichier principal. La même plage dans `ci/jobs.yml` ne
    // désigne pas ce job.
    state().selectByRange("ci/jobs.yml", { start: 0, end: 10 });
    expect(state().selectedJobId).toBeNull();

    state().selectByRange(MAIN, { start: 0, end: 10 });
    expect(state().selectedJobId).toBe("compile");
  });
});

describe("les textes des fichiers inclus survivent à chaque chemin d'entrée", () => {
  /** Trouvé par l'E2E, pas par ce fichier : `documentLoaded` et le rechargement posaient `text`
   *  sans poser `included`, donc `textOf` rendait une chaîne vide pour un fichier inclus et le
   *  panneau affichait « Content unavailable » sur un bloc parfaitement lisible. Même classe de
   *  défaut que l'`applyPayload` qui ne rafraîchissait pas `text` au lot L2 : un champ de l'état
   *  mis à jour sur un seul des trois chemins qui l'alimentent. */
  const INCLUDED_TEXT = "sast:\n  script:\n    - make scan\n";

  function payloadWithIncluded(): DocumentPayload {
    return { ...documentPayload(), included: { "ci/jobs.yml": INCLUDED_TEXT } };
  }

  test("documentLoaded les garde", () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    expect(state().textOf("ci/jobs.yml")).toBe(INCLUDED_TEXT);
  });

  /** Le texte **change** entre le premier chargement et le rechargement. Sans ce changement, ne
   *  pas reposer `included` laisserait en place la valeur du premier chargement et le test
   *  passerait — c'est la première version de ces deux tests, vérifiée incapable d'échouer. */
  const RELOADED_TEXT = "sast:\n  script:\n    - make scan --fast\n";

  test("un rechargement après un événement serveur les repose", async () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    api.queueDocument({
      ok: true,
      value: { ...documentPayload(HASH_B), included: { "ci/jobs.yml": RELOADED_TEXT } },
    });
    await state().serverEvent({ kind: "document.changed", file: MAIN, hash: HASH_B });
    expect(state().textOf("ci/jobs.yml")).toBe(RELOADED_TEXT);
  });

  test("une opération réussie les repose", async () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    api.queue({
      ok: true,
      value: { ...operationPayload(HASH_B, HASH_A), included: { "ci/jobs.yml": RELOADED_TEXT } },
    });
    await addStage("livrer");
    expect(state().textOf("ci/jobs.yml")).toBe(RELOADED_TEXT);
  });

  test("le fichier principal se lit dans text, pas dans included", () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    expect(state().textOf(MAIN)).toBe(payloadWithIncluded().text);
    expect(state().textOf("inconnu.yml")).toBe("");
  });
});

describe("vues et couverture", () => {
  const COVERED: Coverage = {
    jobs: [],
    layers: [{ layer: "sast", covered: true, jobs: ["a"], services: [] }],
    partial: false,
  };

  /** Même forme que `included` : un champ posé sur un seul des trois chemins qui l'alimentent. La
   *  valeur change entre les deux appels, sans quoi le test passerait sans reposer le champ. */
  test("documentLoaded pose la couverture", () => {
    state().documentLoaded(MAIN, { ...documentPayload(), coverage: COVERED });
    expect(state().coverage).toEqual(COVERED);
  });

  test("un rechargement la repose", async () => {
    state().documentLoaded(MAIN, documentPayload());
    api.queueDocument({ ok: true, value: { ...documentPayload(HASH_B), coverage: COVERED } });
    await state().serverEvent({ kind: "document.changed", file: MAIN, hash: HASH_B });
    expect(state().coverage).toEqual(COVERED);
  });

  test("une opération la repose", async () => {
    api.queue({ ok: true, value: { ...operationPayload(HASH_B, HASH_A), coverage: COVERED } });
    await addStage("livrer");
    expect(state().coverage).toEqual(COVERED);
  });

  test("changer de vue oublie la couche et la sélection", () => {
    state().selectJob("compile");
    state().selectLayer("sast");
    state().setView("coverage");
    expect(state().selectedLayer).toBeNull();
    expect(state().selectedJobId).toBeNull();
  });

  test("rechoisir la même couche la libère", () => {
    state().selectLayer("sast");
    expect(state().selectedLayer).toBe("sast");
    state().selectLayer("sast");
    expect(state().selectedLayer).toBeNull();
  });

  test("See tools ouvre le catalogue et le charge une seule fois", async () => {
    state().showTools("dast");
    expect(state().view).toBe("catalog");
    expect(state().catalogLayer).toBe("dast");
    await new Promise((settle) => setTimeout(settle, 0));
    expect(state().catalog).toEqual({ layers: [], tools: [], logos: {} });
  });

  test("un catalogue injoignable devient une erreur à l'écran", async () => {
    const failing = createStore({
      submit: api.submit,
      document: api.document,
      catalog: async () => ({
        ok: false,
        error: { status: 0, code: "NETWORK_ERROR", params: { detail: "x" } },
      }),
      newOpId: () => "op",
    });
    await failing.getState().loadCatalog();
    expect(failing.getState().error?.code).toBe("NETWORK_ERROR");
  });
});

describe("un changement de layout.json", () => {
  const COVERED: Coverage = {
    jobs: [],
    layers: [{ layer: "sast", covered: true, jobs: ["a"], services: [] }],
    partial: false,
  };

  /** Le YAML n'a pas bougé : effacer l'historique et dire « The file changed on disk » serait faux. */
  test("repose la couverture sans toucher l'historique ni rien annoncer", async () => {
    await addStageWith();
    expect(state().canUndo()).toBe(true);

    api.queueDocument({
      ok: true,
      value: { ...documentPayload(HASH_B), coverage: COVERED },
    });
    await state().serverEvent({ kind: "coverage.changed", file: MAIN });

    expect(state().coverage).toEqual(COVERED);
    expect(state().canUndo()).toBe(true);
    expect(state().notice).toBeNull();
  });

  async function addStageWith(): Promise<void> {
    api.queue({ ok: true, value: operationPayload(HASH_B, HASH_A) });
    await addStage("livrer");
  }
});
