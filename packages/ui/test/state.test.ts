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

describe("loading", () => {
  test("the loaded document becomes the current state", () => {
    expect(state().file).toBe(".gitlab-ci.yml");
    expect(state().hash).toBe(HASH_A);
    expect(state().pipeline?.jobs).toHaveLength(1);
    expect(state().status).toBe("ready");
  });

  test("the stacks are empty on load", () => {
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
  });
});

describe("sending operations", () => {
  test("the operation is sent with the current hash and an opId", async () => {
    await addStage("verify");
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.op.baseHash).toBe(HASH_A);
    expect(api.calls[0]?.op.v).toBe(1);
    expect(api.calls[0]?.opId).toBe("op-1");
  });

  test("each operation carries a distinct opId", async () => {
    await addStage("verify");
    await addStage("publish");
    expect(api.calls[0]?.opId).not.toBe(api.calls[1]?.opId);
  });

  test("success updates pipeline and hash", async () => {
    await addStage("verify");
    expect(state().hash).toBe(HASH_B);
    expect(state().pipeline?.jobs).toHaveLength(2);
    expect(state().error).toBeNull();
  });

  test("success pushes an undoable inverse", async () => {
    await addStage("verify");
    expect(state().canUndo()).toBe(true);
    expect(state().canRedo()).toBe(false);
  });
});

describe("undo and redo", () => {
  test("undo sends the inverse to the server", async () => {
    await addStage("verify");
    await state().undo();
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]?.op.kind).toBe("splice");
  });

  test("after undo, redo becomes possible", async () => {
    await addStage("verify");
    await state().undo();
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(true);
  });

  test("redo replays the original operation", async () => {
    await addStage("verify");
    await state().undo();
    await state().redo();
    expect(api.calls).toHaveLength(3);
    expect(api.calls[2]?.op.kind).toBe("addStage");
  });

  test("undo with nothing to undo makes no call", async () => {
    await state().undo();
    expect(api.calls).toEqual([]);
  });

  test("redo with nothing to redo makes no call", async () => {
    await state().redo();
    expect(api.calls).toEqual([]);
  });

  test("a new operation clears the redo stack", async () => {
    await addStage("verify");
    await state().undo();
    expect(state().canRedo()).toBe(true);
    await addStage("publish");
    expect(state().canRedo()).toBe(false);
  });

  test("the inverse sent carries the current hash at undo time", async () => {
    await addStage("verify");
    await state().undo();
    expect(api.calls[1]?.op.baseHash).toBe(HASH_B);
  });

  test("two operations are undone in reverse order", async () => {
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

describe("errors", () => {
  test("a domain error is exposed as is without clearing the stacks", async () => {
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

  test("an error does not advance the hash", async () => {
    api.queue({
      ok: false,
      error: { status: 422, code: "STAGE_EXISTS", params: { stage: "verify" } },
    });
    await addStage("verify");
    expect(state().hash).toBe(HASH_A);
  });

  test("an error pushes no inverse", async () => {
    api.queue({
      ok: false,
      error: { status: 400, code: "INVALID_OPERATION", params: { reason: "missingOp" } },
    });
    await addStage("verify");
    expect(state().canUndo()).toBe(false);
  });

  test("the error is cleared by the next successful operation", async () => {
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

describe("409: the file changed on disk", () => {
  test("reloads the document and clears both stacks", async () => {
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

  test("reports that the file changed and the operation was not applied", async () => {
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

describe("server events", () => {
  test("document.changed reloads and clears the stacks", async () => {
    await addStage("verify");
    expect(state().canUndo()).toBe(true);

    await state().serverEvent({ kind: "document.changed", file: ".gitlab-ci.yml", hash: HASH_C });

    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
    expect(state().hash).toBe(HASH_C);
    expect(state().notice?.kind).toBe("reloaded");
  });

  test("document.removed clears the stacks and marks the document missing", async () => {
    await addStage("verify");
    await state().serverEvent({ kind: "document.removed", file: ".gitlab-ci.yml" });

    expect(state().status).toBe("removed");
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
  });

  test("an event on another file is ignored", async () => {
    await addStage("verify");
    await state().serverEvent({ kind: "document.removed", file: "autre.yml" });
    expect(state().status).toBe("ready");
    expect(state().canUndo()).toBe(true);
  });
});

describe("coverage.changed", () => {
  test("a response made stale by an operation does not replace coverage", async () => {
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

describe("coverage.changed on a lagging client", () => {
  test("the document is reloaded: no event will follow", async () => {
    api.queueDocument({ ok: true, value: documentPayload(HASH_B) });
    api.queueDocument({ ok: true, value: documentPayload(HASH_B) });
    await state().serverEvent({ kind: "coverage.changed", file: MAIN });
    expect(state().hash).toBe(HASH_B);
  });
});

describe("coverage.changed during an operation", () => {
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

  test("the file already written by this operation does not pass for a change", async () => {
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

  test("an operation failing without a 409 lets the pending reload happen", async () => {
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

  test("coverage at an already reached hash applies", async () => {
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

describe("switching files during a write", () => {
  test("the response for the file left does not touch the open file", async () => {
    let settle: (value: ApiResult<OperationPayload>) => void = () => {};
    const held = createStore({
      submit: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
      document: api.document,
      catalog: async () => ({ ok: true, value: { layers: [], tools: [], logos: {} } }),
      newOpId: () => "op",
    });
    held.getState().documentLoaded("a.yml", documentPayload(HASH_A));
    const submitted = held.getState().submit({ kind: "addStage", name: "x" });
    held.getState().documentLoaded("b.yml", documentPayload(HASH_B));
    settle({ ok: true, value: operationPayload(HASH_C, HASH_A) });
    await submitted;
    expect(held.getState().file).toBe("b.yml");
    expect(held.getState().hash).toBe(HASH_B);
    expect(held.getState().canUndo()).toBe(false);
    expect(held.getState().pending).toBe(false);
  });
});

describe("switching files during a reload", () => {
  test("the response for the file left does not replace the open file", async () => {
    let settle: (value: ApiResult<DocumentPayload>) => void = () => {};
    const held = createStore({
      submit: api.submit,
      document: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
      catalog: async () => ({ ok: true, value: { layers: [], tools: [], logos: {} } }),
      newOpId: () => "op",
    });
    held.getState().documentLoaded("a.yml", documentPayload(HASH_A));
    const handled = held
      .getState()
      .serverEvent({ kind: "document.changed", file: "a.yml", hash: HASH_C });
    held.getState().documentLoaded("b.yml", documentPayload(HASH_B));
    settle({ ok: true, value: documentPayload(HASH_C) });
    await handled;
    expect(held.getState().hash).toBe(HASH_B);
  });
});

describe("write announcement", () => {
  test("it does not survive the undo that contradicts it", async () => {
    await addStage("verify");
    state().announce("verify added.");
    api.queue({ ok: true, value: operationPayload(HASH_C, HASH_B) });
    await state().undo();
    expect(state().notice).toBeNull();
  });
});

describe("selection", () => {
  test("a job can be selected then deselected", () => {
    state().selectJob("compile");
    expect(state().selectedJobId).toBe("compile");
    state().selectJob(null);
    expect(state().selectedJobId).toBeNull();
  });

  test("selecting from a diagnostic selects the job of the range", () => {
    state().selectByRange(MAIN, { start: 0, end: 10 });
    expect(state().selectedJobId).toBe("compile");
  });

  test("a range outside any job selects nothing", () => {
    state().selectJob("compile");
    state().selectByRange(MAIN, { start: 9000, end: 9001 });
    expect(state().selectedJobId).toBeNull();
  });

  test("the selection of a vanished job is dropped on reload", async () => {
    state().selectJob("compile");
    api.queueDocument({
      ok: true,
      value: { ...documentPayload(HASH_C), pipeline: pipeline(["autre"]) },
    });
    await state().serverEvent({ kind: "document.changed", file: ".gitlab-ci.yml", hash: HASH_C });
    expect(state().selectedJobId).toBeNull();
  });
});

describe("editing disabled", () => {
  test("editing is disabled when an error diagnostic is present", () => {
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

  test("a validation error does not disable editing: it must be fixable", () => {
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

  test("only unreadable YAML disables editing", () => {
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

  test("a warning does not disable editing", () => {
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

  test("editing is disabled when the document is deleted", async () => {
    await state().serverEvent({ kind: "document.removed", file: ".gitlab-ci.yml" });
    expect(state().canEdit()).toBe(false);
  });

  test("no operation is sent when editing is disabled", async () => {
    await state().serverEvent({ kind: "document.removed", file: ".gitlab-ci.yml" });
    await addStage("verify");
    expect(api.calls).toEqual([]);
  });
});

describe("dismissing banners", () => {
  /** Found by /impeccable critique on 2026-10-22: the error banner's Dismiss button was wired to
   *  dismissNotice(), which never touches `error`. The banner could not be closed. */
  test("dismissError clears the error without touching the notice", async () => {
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

  test("dismissNotice clears the notice without touching the error", async () => {
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

describe("409: the server error survives the reload", () => {
  /** The brief declares "operation rejected (server message shown verbatim)" load-bearing. `send`
   *  set `error` then called `reload`, which reset it to `null`: only the generic notice survived
   *  and the server's message was lost. */
  test("the server's code and message stay displayable after the 409", async () => {
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

describe("the text follows operations", () => {
  /** Found by the 2026-10-22 independent review: `applyPayload` refreshed `pipeline`,
   *  `diagnostics` and `hash`, never `text`. Opaque block ranges come from the new pipeline, the
   *  text stayed that of the last full load, and any operation shifting offsets misaligned the
   *  two. Since the watcher suppresses `document.changed` for the server's own writes, no reload
   *  ever repaired `text`. */
  test("a successful operation replaces the document text", async () => {
    expect(state().text).toBe("stages:\n  - build\n");

    api.queue({
      ok: true,
      value: { ...operationPayload(HASH_B, HASH_B), text: "stages:\n  - build\n  - verify\n" },
    });
    await addStage("verify");

    expect(state().text).toBe("stages:\n  - build\n  - verify\n");
    expect(state().hash).toBe(HASH_B);
  });

  test("an undo restores the previous text", async () => {
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

describe("selection by range with several files", () => {
  /** Two files each have offsets starting at zero. Without the file in the key, the range of a
   *  diagnostic from an included file falls within the range of a main-file job, and the screen
   *  selects a job that has nothing to do with the message being read. */
  test("a range from another file does not select a main-file job", () => {
    state().documentLoaded(MAIN, {
      text: "stages:\n  - build\n",
      pipeline: pipeline(),
      diagnostics: [],
      hash: HASH_A,
      included: { "ci/jobs.yml": "compile:\n" },
      coverage: NO_COVERAGE,
    });

    // `compile` spans [0, 10) in the main file. The same range in `ci/jobs.yml` does not point
    // to this job.
    state().selectByRange("ci/jobs.yml", { start: 0, end: 10 });
    expect(state().selectedJobId).toBeNull();

    state().selectByRange(MAIN, { start: 0, end: 10 });
    expect(state().selectedJobId).toBe("compile");
  });
});

describe("included file texts survive every entry path", () => {
  /** Found by the E2E, not by this file: `documentLoaded` and reload set `text` without setting
   *  `included`, so `textOf` returned an empty string for an included file and the panel showed
   *  "Content unavailable" on a perfectly readable block. Same defect class as the
   *  `applyPayload` that did not refresh `text` in milestone L2: a state field updated on only
   *  one of the three paths that feed it. */
  const INCLUDED_TEXT = "sast:\n  script:\n    - make scan\n";

  function payloadWithIncluded(): DocumentPayload {
    return { ...documentPayload(), included: { "ci/jobs.yml": INCLUDED_TEXT } };
  }

  test("documentLoaded keeps them", () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    expect(state().textOf("ci/jobs.yml")).toBe(INCLUDED_TEXT);
  });

  /** The text **changes** between the first load and the reload. Without that change, not
   *  resetting `included` would leave the first load's value in place and the test would pass —
   *  that was the first version of these two tests, verified unable to fail. */
  const RELOADED_TEXT = "sast:\n  script:\n    - make scan --fast\n";

  test("a reload after a server event sets them again", async () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    api.queueDocument({
      ok: true,
      value: { ...documentPayload(HASH_B), included: { "ci/jobs.yml": RELOADED_TEXT } },
    });
    await state().serverEvent({ kind: "document.changed", file: MAIN, hash: HASH_B });
    expect(state().textOf("ci/jobs.yml")).toBe(RELOADED_TEXT);
  });

  test("a successful operation sets them again", async () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    api.queue({
      ok: true,
      value: { ...operationPayload(HASH_B, HASH_A), included: { "ci/jobs.yml": RELOADED_TEXT } },
    });
    await addStage("livrer");
    expect(state().textOf("ci/jobs.yml")).toBe(RELOADED_TEXT);
  });

  test("the main file is read from text, not from included", () => {
    state().documentLoaded(MAIN, payloadWithIncluded());
    expect(state().textOf(MAIN)).toBe(payloadWithIncluded().text);
    expect(state().textOf("inconnu.yml")).toBe("");
  });
});

describe("views and coverage", () => {
  const COVERED: Coverage = {
    jobs: [],
    layers: [{ layer: "sast", covered: true, jobs: ["a"], services: [] }],
    partial: false,
  };

  /** Same shape as `included`: a field set on only one of the three paths that feed it. The value
   *  changes between the two calls, otherwise the test would pass without resetting the field. */
  test("documentLoaded sets coverage", () => {
    state().documentLoaded(MAIN, { ...documentPayload(), coverage: COVERED });
    expect(state().coverage).toEqual(COVERED);
  });

  test("a reload sets it again", async () => {
    state().documentLoaded(MAIN, documentPayload());
    api.queueDocument({ ok: true, value: { ...documentPayload(HASH_B), coverage: COVERED } });
    await state().serverEvent({ kind: "document.changed", file: MAIN, hash: HASH_B });
    expect(state().coverage).toEqual(COVERED);
  });

  test("an operation sets it again", async () => {
    api.queue({ ok: true, value: { ...operationPayload(HASH_B, HASH_A), coverage: COVERED } });
    await addStage("livrer");
    expect(state().coverage).toEqual(COVERED);
  });

  test("switching views forgets the layer and the selection", () => {
    state().selectJob("compile");
    state().selectLayer("sast");
    state().setView("coverage");
    expect(state().selectedLayer).toBeNull();
    expect(state().selectedJobId).toBeNull();
  });

  test("choosing the same layer again releases it", () => {
    state().selectLayer("sast");
    expect(state().selectedLayer).toBe("sast");
    state().selectLayer("sast");
    expect(state().selectedLayer).toBeNull();
  });

  test("See tools opens the catalogue and loads it only once", async () => {
    state().showTools("dast");
    expect(state().view).toBe("catalog");
    expect(state().catalogLayer).toBe("dast");
    await new Promise((settle) => setTimeout(settle, 0));
    expect(state().catalog).toEqual({ layers: [], tools: [], logos: {} });
  });

  test("an unreachable catalogue becomes an on-screen error", async () => {
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

describe("a layout.json change", () => {
  const COVERED: Coverage = {
    jobs: [],
    layers: [{ layer: "sast", covered: true, jobs: ["a"], services: [] }],
    partial: false,
  };

  /** The YAML did not move: clearing history and saying "The file changed on disk" would be wrong. */
  test("sets coverage again without touching history or announcing anything", async () => {
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
