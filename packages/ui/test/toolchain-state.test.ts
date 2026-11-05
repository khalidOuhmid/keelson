import { beforeEach, describe, expect, test } from "bun:test";
import type { ToolchainOperation } from "@keelson/core";
import type {
  ApiFailure,
  ApiResult,
  ToolchainOperationPayload,
  ToolchainPayload,
} from "../src/api/client.ts";
import { createToolchainStore, type ToolchainStore } from "../src/state/toolchain.ts";

const payload = (hash: string): ToolchainPayload => ({
  text: `# ${hash}\n`,
  hash,
  toolchain: { services: [], integrations: [], dismissed: [] },
  diagnostics: [],
  proposed: [],
  positions: {},
});

const inverse = (baseHash: string) =>
  ({ v: 1, baseHash, kind: "splice", start: 0, end: 0, text: "" }) as const;

const applied = (hash: string): ApiResult<ToolchainOperationPayload> => ({
  ok: true,
  value: { ...payload(hash), inverse: inverse(hash) },
});

const failure = (status: number): ApiResult<ToolchainOperationPayload> => ({
  ok: false,
  error: { status, code: "INTERNAL_ERROR", params: {} } as ApiFailure,
});

let sent: ToolchainOperation[];
let answers: ApiResult<ToolchainOperationPayload>[];
let loaded: ToolchainPayload;
let saved: unknown[];
let store: ToolchainStore;
const state = () => store.getState();

beforeEach(async () => {
  sent = [];
  answers = [];
  saved = [];
  loaded = payload("a");
  store = createToolchainStore({
    load: async () => ({ ok: true, value: loaded }),
    submit: async (op) => {
      sent.push(op);
      return answers.shift() ?? applied("b");
    },
    savePositions: async (positions) => {
      saved.push(positions);
      return { ok: true, value: { positions } };
    },
    newOpId: () => "op",
  });
  await state().load();
});

const draft = { kind: "removeService", id: "x" } as const;

describe("store de toolchain", () => {
  test("une opération part avec le hash courant", async () => {
    await state().submit(draft);
    expect(sent[0]).toEqual({ v: 1, baseHash: "a", ...draft });
    expect(state().payload?.hash).toBe("b");
  });

  test("annuler envoie l'inverse, rétablir l'inverse de l'annulation", async () => {
    await state().submit(draft);
    answers.push(applied("c"));
    await state().undo();
    expect(sent[1]).toEqual(inverse("b"));
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(true);

    await state().redo();
    expect(sent[2]).toEqual(inverse("c"));
    expect(state().canUndo()).toBe(true);
  });

  test("une nouvelle opération vide la pile de rétablissement", async () => {
    await state().submit(draft);
    await state().undo();
    await state().submit(draft);
    expect(state().canRedo()).toBe(false);
  });

  test("un 409 recharge, vide l'historique et garde l'erreur", async () => {
    await state().submit(draft);
    answers.push(failure(409));
    loaded = payload("z");
    await state().submit(draft);
    expect(state().payload?.hash).toBe("z");
    expect(state().canUndo()).toBe(false);
    expect(state().error?.status).toBe(409);
  });

  test("submit dit si l'écriture a eu lieu", async () => {
    expect(await state().submit(draft)).toBe(true);
    answers.push(failure(422));
    expect(await state().submit(draft)).toBe(false);
  });

  test("un autre échec garde l'état et dit l'erreur", async () => {
    answers.push(failure(422));
    await state().submit(draft);
    expect(state().payload?.hash).toBe("a");
    expect(state().error?.status).toBe(422);
  });

  test("toolchain.changed au hash connu ne fait rien : c'est notre écriture", async () => {
    await state().submit(draft);
    await state().changed("b");
    expect(state().canUndo()).toBe(true);
  });

  test("toolchain.changed à un autre hash recharge et vide l'historique", async () => {
    await state().submit(draft);
    loaded = payload("z");
    await state().changed("z");
    expect(state().payload?.hash).toBe("z");
    expect(state().canUndo()).toBe(false);
  });

  test("déplacer un nœud envoie toutes les positions connues", async () => {
    await state().move("job:a", { x: 1, y: 2 });
    await state().move("job:b", { x: 3, y: 4 });
    expect(saved.at(-1)).toEqual({ "job:a": { x: 1, y: 2 }, "job:b": { x: 3, y: 4 } });
    expect(state().payload?.positions).toEqual({
      "job:a": { x: 1, y: 2 },
      "job:b": { x: 3, y: 4 },
    });
  });
});
