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
let disk: Record<string, { x: number; y: number }>;
let store: ToolchainStore;
const state = () => store.getState();

beforeEach(async () => {
  sent = [];
  answers = [];
  saved = [];
  disk = {};
  loaded = payload("a");
  store = createToolchainStore({
    load: async () => ({ ok: true, value: loaded }),
    submit: async (op) => {
      sent.push(op);
      return answers.shift() ?? applied("b");
    },
    savePositions: async (positions) => {
      saved.push(positions);
      disk = { ...disk, ...positions };
      return { ok: true, value: { positions: disk } };
    },
    newOpId: () => "op",
  });
  await state().load();
});

const draft = { kind: "removeService", id: "x" } as const;

describe("toolchain store", () => {
  test("an operation is sent with the current hash", async () => {
    await state().submit(draft);
    expect(sent[0]).toEqual({ v: 1, baseHash: "a", ...draft });
    expect(state().payload?.hash).toBe("b");
  });

  test("undo sends the inverse, redo the inverse of the undo", async () => {
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

  test("a new operation clears the redo stack", async () => {
    await state().submit(draft);
    await state().undo();
    await state().submit(draft);
    expect(state().canRedo()).toBe(false);
  });

  test("a 409 reloads, clears history and keeps the error", async () => {
    await state().submit(draft);
    answers.push(failure(409));
    loaded = payload("z");
    await state().submit(draft);
    expect(state().payload?.hash).toBe("z");
    expect(state().canUndo()).toBe(false);
    expect(state().error?.status).toBe(409);
  });

  test("submit says whether the write happened", async () => {
    expect(await state().submit(draft)).toBe(true);
    answers.push(failure(422));
    expect(await state().submit(draft)).toBe(false);
  });

  test("another failure keeps the state and reports the error", async () => {
    answers.push(failure(422));
    await state().submit(draft);
    expect(state().payload?.hash).toBe("a");
    expect(state().error?.status).toBe(422);
  });

  test("toolchain.changed at the known hash does nothing: it is our own write", async () => {
    await state().submit(draft);
    await state().changed("b");
    expect(state().canUndo()).toBe(true);
  });

  test("toolchain.changed at another hash reloads and clears history", async () => {
    await state().submit(draft);
    loaded = payload("z");
    await state().changed("z");
    expect(state().payload?.hash).toBe("z");
    expect(state().canUndo()).toBe(false);
  });

  test("two quick undos do not send the same inverse twice", async () => {
    await state().submit(draft);
    await state().submit(draft);
    sent.length = 0;
    await Promise.all([state().undo(), state().undo()]);
    expect(sent).toHaveLength(1);
  });

  test("an external change during an operation reloads afterwards", async () => {
    let settle: (value: ApiResult<ToolchainOperationPayload>) => void = () => {};
    const held = createToolchainStore({
      load: async () => ({ ok: true, value: loaded }),
      submit: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
      savePositions: async (positions) => ({ ok: true, value: { positions } }),
      newOpId: () => "op",
    });
    await held.getState().load();
    const submitted = held.getState().submit(draft);
    await held.getState().changed("z");
    loaded = payload("z");
    settle(applied("b"));
    await submitted;
    await Promise.resolve();
    await Promise.resolve();
    expect(held.getState().payload?.hash).toBe("z");
  });

  test("the echo of our write during the next operation does not reload", async () => {
    await state().submit(draft);
    let settle: (value: ApiResult<ToolchainOperationPayload>) => void = () => {};
    const echo = createToolchainStore({
      load: async () => ({ ok: true, value: payload("a") }),
      submit: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
      savePositions: async (positions) => ({ ok: true, value: { positions } }),
      newOpId: () => "op",
    });
    await echo.getState().load();
    const first = echo.getState().submit(draft);
    settle(applied("b"));
    await first;
    const second = echo.getState().submit(draft);
    await echo.getState().changed("b");
    settle(applied("c"));
    await second;
    expect(echo.getState().notice).toBeNull();
    expect(echo.getState().canUndo()).toBe(true);
  });

  test("the late echo of an already superseded write does not reload", async () => {
    await state().submit(draft);
    answers.push(applied("c"));
    await state().submit(draft);
    await state().changed("b");
    expect(state().notice).toBeNull();
    expect(state().canUndo()).toBe(true);
  });

  test("an external revert to an already written text shows, once the echo is past", async () => {
    await state().submit(draft);
    answers.push(applied("c"));
    await state().submit(draft);
    await state().changed("b");
    await state().changed("c");
    loaded = payload("b");
    await state().changed("b");
    expect(state().payload?.hash).toBe("b");
    expect(state().notice?.kind).toBe("reloaded");
  });

  test("echoes grouped by the debounce leave no trace", async () => {
    await state().submit(draft);
    answers.push(applied("c"));
    await state().submit(draft);
    await state().changed("c");
    loaded = payload("b");
    await state().changed("b");
    expect(state().payload?.hash).toBe("b");
  });

  test("a hash written twice: the echo consumes up to the last occurrence", async () => {
    await state().submit(draft);
    answers.push(applied("a"));
    await state().submit(draft);
    answers.push(applied("b"));
    await state().submit(draft);
    await state().changed("b");
    loaded = payload("a");
    await state().changed("a");
    expect(state().payload?.hash).toBe("a");
  });

  test("a reloaded external write says so", async () => {
    loaded = payload("z");
    await state().changed("z");
    expect(state().notice?.kind).toBe("reloaded");
  });

  test("moving a node sends only that node: the rest is the server's job", async () => {
    await state().move("job:a", { x: 1, y: 2 });
    await state().move("job:b", { x: 3, y: 4 });
    expect(saved.at(-1)).toEqual({ "job:b": { x: 3, y: 4 } });
    expect(state().payload?.positions).toEqual({
      "job:a": { x: 1, y: 2 },
      "job:b": { x: 3, y: 4 },
    });
  });
});
