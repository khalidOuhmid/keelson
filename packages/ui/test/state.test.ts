import { beforeEach, describe, expect, test } from "bun:test";
import type { Operation, Pipeline } from "@keelson/core";
import type { ApiResult, DocumentPayload, OperationPayload } from "../src/api/client.ts";
import { createStore, type KeelsonStore } from "../src/state/store.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function pipeline(jobs: string[] = ["compile"]): Pipeline {
  return {
    stages: [{ name: "build", implicit: false, range: { start: 0, end: 5 } }],
    jobs: jobs.map((id) => ({
      id,
      stage: { value: "build", origin: { kind: "local" } },
      needs: null,
      environment: null,
      extends: [],
      opaque: [],
      range: { start: 0, end: 10 },
    })),
    templates: [],
    opaque: [],
  };
}

function documentPayload(hash = HASH_A): DocumentPayload {
  return { text: "stages:\n  - build\n", pipeline: pipeline(), diagnostics: [], hash };
}

function operationPayload(hash: string, inverseHash: string): OperationPayload {
  return {
    pipeline: pipeline(["compile", "unit"]),
    diagnostics: [],
    hash,
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

  document = async (): Promise<ApiResult<DocumentPayload>> =>
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
      error: { status: 422, code: "JOB_REFERENCED", message: "le job est référencé" },
    });
    await addStage("publish");

    expect(state().error?.code).toBe("JOB_REFERENCED");
    expect(state().error?.message).toBe("le job est référencé");
    expect(state().canUndo()).toBe(true);
  });

  test("une erreur n'avance pas le hash", async () => {
    api.queue({
      ok: false,
      error: { status: 422, code: "STAGE_EXISTS", message: "déjà là" },
    });
    await addStage("verify");
    expect(state().hash).toBe(HASH_A);
  });

  test("une erreur n'empile pas d'inverse", async () => {
    api.queue({ ok: false, error: { status: 400, code: "INVALID_OPERATION", message: "non" } });
    await addStage("verify");
    expect(state().canUndo()).toBe(false);
  });

  test("l'erreur est effacée par l'opération suivante réussie", async () => {
    api.queue({ ok: false, error: { status: 422, code: "STAGE_EXISTS", message: "déjà là" } });
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
      error: { status: 409, code: "STALE_DOCUMENT", message: "périmé", hash: HASH_C },
    });
    await addStage("publish");

    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
    expect(state().hash).toBe(HASH_C);
  });

  test("informe que le fichier a changé et que l'opération n'a pas été appliquée", async () => {
    api.queue({
      ok: false,
      error: { status: 409, code: "STALE_DOCUMENT", message: "périmé", hash: HASH_C },
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

describe("sélection", () => {
  test("un job peut être sélectionné puis désélectionné", () => {
    state().selectJob("compile");
    expect(state().selectedJobId).toBe("compile");
    state().selectJob(null);
    expect(state().selectedJobId).toBeNull();
  });

  test("sélectionner depuis un diagnostic sélectionne le job de la plage", () => {
    state().selectByRange({ start: 0, end: 10 });
    expect(state().selectedJobId).toBe("compile");
  });

  test("une plage hors de tout job ne sélectionne rien", () => {
    state().selectJob("compile");
    state().selectByRange({ start: 9000, end: 9001 });
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
      diagnostics: [{ code: "INVALID_YAML", severity: "error", message: "cassé", range: null }],
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
          message: "need vers un job inexistant",
          range: { start: 0, end: 5 },
        },
      ],
    });
    expect(state().canEdit()).toBe(true);
  });

  test("seul un YAML illisible désactive l'édition", () => {
    state().documentLoaded(".gitlab-ci.yml", {
      ...documentPayload(),
      diagnostics: [
        { code: "INVALID_YAML", severity: "error", message: "cassé", range: null },
        {
          code: "UNKNOWN_NEED",
          severity: "error",
          message: "need absent",
          range: { start: 0, end: 5 },
        },
      ],
    });
    expect(state().canEdit()).toBe(false);
  });

  test("un avertissement ne désactive pas l'édition", () => {
    state().documentLoaded(".gitlab-ci.yml", {
      ...documentPayload(),
      diagnostics: [
        { code: "JOB_WITHOUT_SCRIPT", severity: "warning", message: "muet", range: null },
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
