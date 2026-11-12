import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Coverage } from "@keelson/catalog";
import type { Operation, Pipeline } from "@keelson/core";
import { findLayer, LAYERS } from "@keelson/taxonomy";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ApiResult,
  CatalogPayload,
  DocumentPayload,
  OperationPayload,
  ToolchainPayload,
} from "../src/api/client.ts";
import type { ServerEvent } from "../src/api/events.ts";
import { App, type AppDeps } from "../src/app.tsx";
import { LAYOUT_TOKENS } from "../src/views/pipeline/metrics.ts";
import { narrowViewport, restoreViewport } from "./support/viewport.ts";

const MAIN = ".gitlab-ci.yml";

const NO_COVERAGE: Coverage = { jobs: [], layers: [], partial: false };

const TOOLCHAIN: ToolchainPayload = {
  text: "",
  hash: "a".repeat(64),
  toolchain: { services: [], integrations: [], dismissed: [] },
  diagnostics: [],
  proposed: [],
  positions: {},
};

const INVERSE = {
  v: 1,
  baseHash: "a".repeat(64),
  kind: "splice",
  start: 0,
  end: 0,
  text: "",
} as const;

const CATALOG: CatalogPayload = { layers: [...LAYERS], tools: [], logos: {} };

const HASH = "a".repeat(64);
const NEXT = "b".repeat(64);

beforeEach(() => {
  document.documentElement.style.setProperty(LAYOUT_TOKENS.nodeWidth, "200px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.nodeHeight, "64px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.columnGap, "72px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.rowGap, "20px");
});

afterEach(cleanup);

function pipeline(): Pipeline {
  return {
    stages: ["build", "test"].map((name) => ({ name, implicit: false, range: null, file: MAIN })),
    jobs: [
      {
        id: "compile",
        stage: { value: "build", origin: { kind: "local" } },
        needs: null,
        environment: null,
        extends: [],
        opaque: [],
        signals: { image: null, script: [] },
        range: { start: 0, end: 20 },
        file: MAIN,
      },
      {
        id: "unit",
        stage: { value: "test", origin: { kind: "extends", template: ".base" } },
        needs: {
          value: [{ job: "compile", optional: false, artifacts: true }],
          origin: { kind: "local" },
        },
        environment: null,
        extends: [".base"],
        opaque: [],
        signals: { image: null, script: [] },
        range: { start: 20, end: 60 },
        file: MAIN,
      },
    ],
    templates: [],
    opaque: [],
    main: MAIN,
    files: [MAIN],
    unresolved: [],
  };
}

const DOCUMENT_TEXT = "stages:\n  - build\n  - test\n";

const DOCUMENT: DocumentPayload = {
  text: DOCUMENT_TEXT,
  pipeline: pipeline(),
  diagnostics: [],
  hash: HASH,
  included: {},
  coverage: NO_COVERAGE,
};

type Harness = {
  deps: AppDeps;
  submitted: { op: Operation; opId: string }[];
  emit: (event: ServerEvent) => void;
  queueSubmit: (result: ApiResult<OperationPayload>) => void;
  queueDocument: (result: ApiResult<DocumentPayload>) => void;
  subscriptions: number;
  closed: number;
};

function harness(
  options: { files?: { path: string; adapter: "gitlab" }[]; document?: DocumentPayload } = {},
): Harness {
  const submitted: Harness["submitted"] = [];
  const submits: ApiResult<OperationPayload>[] = [];
  const documents: ApiResult<DocumentPayload>[] = [];
  let listener: (event: ServerEvent) => void = () => undefined;
  const state = { subscriptions: 0, closed: 0 };

  const ok: OperationPayload = {
    text: DOCUMENT_TEXT,
    pipeline: pipeline(),
    diagnostics: [],
    hash: NEXT,
    included: {},
    coverage: NO_COVERAGE,
    inverse: { v: 1, baseHash: NEXT, kind: "splice", start: 0, end: 0, text: "" },
    touched: [],
  };

  const result: Harness = {
    submitted,
    emit: (event) => listener(event),
    queueSubmit: (value) => submits.push(value),
    queueDocument: (value) => documents.push(value),
    get subscriptions() {
      return state.subscriptions;
    },
    get closed() {
      return state.closed;
    },
    deps: {
      client: {
        workspace: async () => ({
          ok: true,
          value: { files: options.files ?? [{ path: ".gitlab-ci.yml", adapter: "gitlab" }] },
        }),
        catalog: async () => ({ ok: true, value: CATALOG }),
        document: async () =>
          documents.shift() ?? { ok: true, value: options.document ?? DOCUMENT },
        submit: async (_file, op, opId) => {
          submitted.push({ op, opId });
          return submits.shift() ?? { ok: true, value: ok };
        },
        preview: async () => ({ ok: true, value: ok }),
        toolchain: async () => ({ ok: true, value: TOOLCHAIN }),
        submitToolchain: async () => ({ ok: true, value: { ...TOOLCHAIN, inverse: INVERSE } }),
        savePositions: async (positions) => ({ ok: true, value: { positions } }),
        eventsUrl: () => "/api/events?token=x",
      },
      subscribe: (_url, onEvent) => {
        state.subscriptions += 1;
        listener = onEvent;
        return {
          close() {
            state.closed += 1;
          },
        };
      },
      newOpId: (() => {
        let counter = 0;
        return () => {
          counter += 1;
          return `op-${counter}`;
        };
      })(),
    },
  };

  return result;
}

async function renderApp(h: Harness) {
  const view = render(<App deps={h.deps} />);
  await waitFor(() => expect(screen.queryByRole("region", { name: /pipeline/i })).not.toBeNull());
  return view;
}

describe("loading", () => {
  test("loads the workspace then the first document", async () => {
    await renderApp(harness());
    expect(await screen.findByRole("button", { name: /compile/ })).toBeDefined();
  });

  test("shows the empty state when no CI file is detected", async () => {
    render(<App deps={harness({ files: [] }).deps} />);
    expect(await screen.findByRole("heading", { name: /no ci file/i })).toBeDefined();
  });

  test("names the loaded file", async () => {
    await renderApp(harness());
    expect(screen.getByText(".gitlab-ci.yml")).toBeDefined();
  });
});

describe("event subscription", () => {
  test("subscribes once on mount", async () => {
    const h = harness();
    await renderApp(h);
    expect(h.subscriptions).toBe(1);
  });

  test("closes the subscription on unmount", async () => {
    const h = harness();
    const view = await renderApp(h);
    view.unmount();
    expect(h.closed).toBe(1);
  });

  test("a document.changed reloads and says so", async () => {
    const h = harness();
    await renderApp(h);
    h.emit({ kind: "document.changed", file: ".gitlab-ci.yml", hash: NEXT });
    expect(await screen.findByText(/changed on disk/i)).toBeDefined();
  });

  test("a document.removed shows the deleted state", async () => {
    const h = harness();
    await renderApp(h);
    h.emit({ kind: "document.removed", file: ".gitlab-ci.yml" });
    expect(await screen.findByRole("heading", { name: /deleted/i })).toBeDefined();
  });
});

describe("selection and panels", () => {
  test("clicking a job opens its detail panel", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    expect(await screen.findByRole("region", { name: /job detail/i })).toBeDefined();
  });

  test("the panel shows the selected job's origin badge", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    const panel = await screen.findByRole("region", { name: /job detail/i });
    expect(panel.textContent).toContain("inherited from .base");
  });

  test("no detail panel without a selection", async () => {
    await renderApp(harness());
    expect(screen.queryByRole("region", { name: /job detail/i })).toBeNull();
  });

  test("the diagnostics panel is always present", async () => {
    await renderApp(harness());
    expect(screen.getByRole("region", { name: /diagnostics/i })).toBeDefined();
  });
});

describe("editing", () => {
  test("an editing action sends an operation with the current hash", async () => {
    const h = harness();
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));

    await waitFor(() => expect(h.submitted).toHaveLength(1));
    expect(h.submitted[0]?.op).toEqual({
      v: 1,
      baseHash: HASH,
      kind: "addStage",
      name: "verify",
    });
    expect(h.submitted[0]?.opId).toBe("op-1");
  });

  test("after a successful operation, Undo becomes enabled", async () => {
    const h = harness();
    await renderApp(h);
    expect(screen.getByRole("button", { name: /undo/i }).hasAttribute("disabled")).toBe(true);

    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /undo/i }).hasAttribute("disabled")).toBe(false),
    );
  });

  test("Undo sends the inverse to the server", async () => {
    const h = harness();
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    await waitFor(() => expect(h.submitted).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(h.submitted).toHaveLength(2));
    expect(h.submitted[1]?.op.kind).toBe("splice");
  });

  test("the server error is rendered in English from its code and params", async () => {
    const h = harness();
    h.queueSubmit({
      ok: false,
      error: { status: 422, code: "STAGE_EXISTS", params: { stage: "build" } },
    });
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "test");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));

    expect(await screen.findByText('stage "build" already exists')).toBeDefined();
    expect(await screen.findByText("STAGE_EXISTS")).toBeDefined();
  });

  test("a 409 reloads, clears the stacks and says the operation was not applied", async () => {
    const h = harness();
    h.queueSubmit({
      ok: false,
      error: {
        status: 409,
        code: "STALE_DOCUMENT",
        params: { expected: NEXT, received: HASH },
        hash: NEXT,
      },
    });
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));

    const kind = await screen.findByTestId("notice-kind");
    expect(kind.textContent).toMatch(/not applied/i);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /undo/i }).hasAttribute("disabled")).toBe(true),
    );
  });
});

describe("invalid YAML", () => {
  const broken: DocumentPayload = {
    ...DOCUMENT,
    diagnostics: [
      {
        code: "INVALID_YAML",
        severity: "error",
        params: { detail: "indentation" },
        range: null,
        file: MAIN,
      },
    ],
  };

  test("shows the invalid state and disables editing", async () => {
    render(<App deps={harness({ document: broken }).deps} />);
    expect(await screen.findByRole("heading", { name: /cannot be parsed/i })).toBeDefined();
  });

  test("no editing form is offered", async () => {
    render(<App deps={harness({ document: broken }).deps} />);
    await screen.findByRole("heading", { name: /cannot be parsed/i });
    expect(screen.queryByRole("textbox", { name: /new stage name/i })).toBeNull();
  });
});

describe("the editor follows the selected job", () => {
  /** Found by /impeccable critique on 2026-10-22: `JobEditor` was mounted without a `key`, so its
   *  local state survived a selection change and `Rename` submitted a name the user had never
   *  typed. File-corruption class. */
  test("the fields reflect the new job, not the previous one", async () => {
    await renderApp(harness());

    await userEvent.click(await screen.findByRole("button", { name: /compile/ }));
    expect(
      ((await screen.findByRole("textbox", { name: "Job id" })) as HTMLInputElement).value,
    ).toBe("compile");

    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    expect(
      ((await screen.findByRole("textbox", { name: "Job id" })) as HTMLInputElement).value,
    ).toBe("unit");
  });

  test("renaming after a selection change submits the displayed job", async () => {
    const h = harness();
    await renderApp(h);

    await userEvent.click(await screen.findByRole("button", { name: /compile/ }));
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));

    const field = await screen.findByRole("textbox", { name: "Job id" });
    await userEvent.clear(field);
    await userEvent.type(field, "unit-tests");
    await userEvent.click(screen.getByRole("button", { name: /rename/i }));

    expect(h.submitted.map((entry) => entry.op)).toEqual([
      { v: 1, baseHash: HASH, kind: "renameJob", from: "unit", to: "unit-tests" },
    ]);
  });
});

describe("layout invariants, on the render", () => {
  /** "Layout invariants" rule: consistency between the IR and the display is tested on the
   *  render, not only on coordinates. The `layout.test.ts` tests would not have seen a regression
   *  of the render itself — it was a screenshot that found `lint` in `build`. */
  const NODE_WIDTH = 200;

  function placed(): Map<string, number> {
    const boxes = new Map<string, number>();
    for (const element of document.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const id = element.getAttribute("data-id");
      const match = /translate\(\s*(-?[\d.]+)px/.exec(element.style.transform);
      if (id !== null && match?.[1] !== undefined) {
        boxes.set(id, Number(match[1]));
      }
    }
    return boxes;
  }

  /** `lint` has no edge, in a late stage: that is the exact shape that used to land a job in the
   *  previous stage's column. The harness pipeline, all edges, does not reproduce it and would
   *  leave these tests green by construction. */
  const WITH_ORPHAN: DocumentPayload = (() => {
    const base = pipeline();
    const [compile] = base.jobs;
    return {
      ...DOCUMENT,
      pipeline: {
        ...base,
        jobs: [
          ...base.jobs,
          {
            ...(compile as NonNullable<typeof compile>),
            id: "lint",
            stage: { value: "test", origin: { kind: "local" } },
            needs: null,
            range: { start: 60, end: 80 },
          },
        ],
      },
    };
  })();

  async function rendered() {
    await renderApp(harness({ document: WITH_ORPHAN }));
    await screen.findByRole("button", { name: /lint/ });

    const boxes = placed();
    const columns = [...boxes.entries()]
      .filter(([id]) => id.startsWith("column:"))
      .map(([id, x]) => ({ name: id.slice("column:".length), x }));
    const jobs = [...boxes.entries()]
      .filter(([id]) => !id.startsWith("column:"))
      .map(([id, x]) => ({ id, x }));

    return { columns, jobs };
  }

  /** The stage is read from the node's accessible description, not from the IR: it is what the
   *  screen reader announces and what the user reads under the title. The invariant therefore
   *  compares the display with itself, not the computation with itself. */
  function announcedStage(id: string): string {
    const description = document.getElementById(`job-${id}-description`)?.textContent ?? "";
    return /Stage ([^.]+)\./.exec(description)?.[1] ?? "";
  }

  test("every rendered job falls in the column of the stage it declares", async () => {
    const { columns, jobs } = await rendered();
    expect(jobs.length).toBe(3);

    for (const job of jobs) {
      const centre = job.x + NODE_WIDTH / 2;
      const containing = columns.filter(
        (column) => centre >= column.x && centre <= column.x + NODE_WIDTH,
      );
      expect({ job: job.id, stages: containing.map((column) => column.name) }).toEqual({
        job: job.id,
        stages: [announcedStage(job.id)],
      });
    }
  });

  test("the header count equals the number of jobs rendered in the column", async () => {
    const { columns, jobs } = await rendered();

    for (const column of columns) {
      const inside = jobs.filter((job) => {
        const centre = job.x + NODE_WIDTH / 2;
        return centre >= column.x && centre <= column.x + NODE_WIDTH;
      }).length;

      const header = screen.getByRole("group", { name: `Stage ${column.name}` });
      expect({ stage: column.name, header: header.textContent }).toEqual({
        stage: column.name,
        header: `${column.name}${inside} ${inside === 1 ? "job" : "jobs"}`,
      });
    }
  });
});

describe("banners and in-flight operation, on the render", () => {
  function deferredHarness() {
    const h = harness();
    let release: (() => void) | null = null;
    const original = h.deps.client.submit;

    h.deps.client.submit = async (file, op, opId) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(file, op, opId);
    };

    return { h, release: () => release?.() };
  }

  async function addStage(name: string): Promise<void> {
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), name);
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
  }

  test("the Dismiss button really closes the error banner", async () => {
    const h = harness();
    h.queueSubmit({
      ok: false,
      error: { status: 422, code: "STAGE_EXISTS", params: { stage: "build" } },
    });
    await renderApp(h);

    await addStage("build");
    expect(await screen.findByText("STAGE_EXISTS")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByText("STAGE_EXISTS")).toBeNull());
  });

  test("an in-flight operation disables the editing controls and is announced", async () => {
    const { h, release } = deferredHarness();
    await renderApp(h);

    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");

    // The click is not awaited right away: `act` would wait for the submission, which we are
    // holding in flight on purpose. It is awaited after release, so as not to leak across tests.
    const clicked = userEvent.click(screen.getByRole("button", { name: /add stage/i }));

    expect(await screen.findByTestId("pending-indicator")).toBeDefined();
    expect((screen.getByRole("button", { name: /add stage/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    release();
    await clicked;

    await waitFor(() => expect(screen.queryByTestId("pending-indicator")).toBeNull());
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /add stage/i }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});

describe("Undo while an operation is in flight", () => {
  test("Undo and Redo are disabled until the response arrives", async () => {
    const h = harness();
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false));

    let release: () => void = () => {};
    const original = h.deps.client.submit;
    h.deps.client.submit = async (file, op, opId) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(file, op, opId);
    };
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "publish");
    const clicked = userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    await screen.findByTestId("pending-indicator");
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);

    release();
    await clicked;
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });
});

describe("the file picker follows the workspace", () => {
  const WORKFLOW = ".github/workflows/ci.yml";

  test("a workflow created while Keelson runs appears in the picker, and leaves it when removed", async () => {
    const h = harness();
    await renderApp(h);
    expect(screen.queryByLabelText("Pipeline file")).toBeNull();

    h.emit({
      kind: "workspace.changed",
      files: [
        { path: MAIN, adapter: "gitlab" },
        { path: WORKFLOW, adapter: "github" },
      ],
    });
    const picker = await screen.findByLabelText("Pipeline file");
    expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      MAIN,
      "ci.yml",
    ]);

    h.emit({ kind: "workspace.changed", files: [{ path: MAIN, adapter: "gitlab" }] });
    await new Promise((settle) => setTimeout(settle, 20));
    expect(screen.queryByLabelText("Pipeline file")).toBeNull();
  });
});

describe("what was just written", () => {
  test("the notice names the lines the write changed", async () => {
    const h = harness();
    h.queueSubmit({
      ok: true,
      value: {
        text: DOCUMENT_TEXT,
        pipeline: pipeline(),
        diagnostics: [],
        hash: NEXT,
        included: {},
        coverage: NO_COVERAGE,
        inverse: { v: 1, baseHash: NEXT, kind: "splice", start: 0, end: 0, text: "" },
        touched: [{ start: 18, end: 27 }],
      },
    });
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    const notice = await screen.findByText("Changed line 3 of .gitlab-ci.yml.");
    expect(notice.closest("[role=status]")).not.toBeNull();
  });
});

describe("a write from another tab", () => {
  test("another tab's write reloads the screen and says so; this tab's own does not", async () => {
    const h = harness();
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    await waitFor(() => expect(h.submitted).toHaveLength(1));

    h.emit({ kind: "document.written", file: MAIN, hash: "c".repeat(64), opId: "op-1" });
    await new Promise((settle) => setTimeout(settle, 20));
    expect(screen.queryByText(/another keelson tab wrote the file/i)).toBeNull();

    h.emit({ kind: "document.written", file: MAIN, hash: "c".repeat(64), opId: "elsewhere" });
    expect(await screen.findByText(/another keelson tab wrote the file/i)).toBeDefined();
  });
});

describe("closing the detail panel from the keyboard", () => {
  /** Found by /impeccable critique on 2026-10-22: `onSelectJob(null)` could only be reached by a
   *  mouse click on the canvas background. No keyboard user could close the panel, and fifteen
   *  controls stayed in its tab cycle for good. */
  test("Escape closes the panel", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    expect(await screen.findByRole("region", { name: /job detail/i })).toBeDefined();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: /job detail/i })).toBeNull());
  });

  test("the panel has a close button", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));

    await userEvent.click(screen.getByRole("button", { name: "Close job detail" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /job detail/i })).toBeNull());
  });
});

describe("the sidebar is grouped", () => {
  /** The 2026-10-22 critique: twelve controls for two unrelated tasks followed one another on an
   *  undifferentiated surface, and `LABEL` served both as section heading and field label — a
   *  single voice, hence no hierarchy. */
  test("two named sections, one for stages, the other for job creation", async () => {
    await renderApp(harness());

    expect(screen.getByRole("group", { name: "Stages" })).toBeDefined();
    expect(screen.getByRole("group", { name: "New job" })).toBeDefined();
  });

  test("the section heading is not confused with a field label", async () => {
    await renderApp(harness());

    const heading = screen.getByText("Stages");
    const label = screen.getByText("New stage name");
    expect(heading.className).not.toBe(label.className);
  });
});

describe("focus never falls onto the document body", () => {
  /** Independent review: after Escape as after a confirmed deletion, `document.activeElement` was
   *  `<body>`. When the detail panel disappears, focus returns to the job's node, the control
   *  that opened it, so the arrows carry on from there. */
  test("closing the panel returns focus to the node of the job it showed", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    await screen.findByRole("region", { name: /job detail/i });

    await userEvent.click(screen.getByRole("button", { name: "Close job detail" }));

    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.jobId).toBe("unit"));
  });

  test("Escape from inside the panel also returns focus to the node", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /compile/ }));
    await screen.findByRole("region", { name: /job detail/i });
    screen.getByRole("button", { name: "Close job detail" }).focus();

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect((document.activeElement as HTMLElement).dataset.jobId).toBe("compile"),
    );
  });
});

describe("confirmed deletion: focus and selection", () => {
  /** Second review: the refocus effect fired on `selectedJobId`, which `applyPayload` never resets
   *  to `null`. After a confirmed deletion, the panel disappeared but the effect did not fire, and
   *  focus fell back onto `<body>` — right when the product has just rewritten the file. The code
   *  comment claimed the opposite. */
  function withoutUnit() {
    const base = pipeline();
    return { ...base, jobs: base.jobs.filter((candidate) => candidate.id !== "compile") };
  }

  test("focus returns to the graph and the selection is released", async () => {
    const h = harness();
    h.queueSubmit({
      ok: true,
      value: {
        text: DOCUMENT_TEXT,
        pipeline: withoutUnit(),
        diagnostics: [],
        hash: NEXT,
        included: {},
        coverage: NO_COVERAGE,
        inverse: { v: 1, baseHash: NEXT, kind: "splice", start: 0, end: 0, text: "" },
        touched: [],
      },
    });
    await renderApp(h);

    await userEvent.click(await screen.findByRole("button", { name: /compile/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete compile" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: /job detail/i })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("region", { name: "Pipeline graph" })),
    );
  });
});

describe("Escape in the confirmation does not reach the panel", () => {
  /** Second review: the dialog's `stopPropagation` was only covered by a test that mounts
   *  `JobEditor` alone, hence without `app.tsx`'s document listener. Removing it turned no test
   *  red. This one mounts the whole application. */
  test("Escape closes the dialog and leaves the panel open", async () => {
    await renderApp(harness());

    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    expect(screen.getByRole("alertdialog")).toBeDefined();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("region", { name: /job detail/i })).toBeDefined();
  });
});

describe("landmarks and heading outline", () => {
  test("the product name is the page's one level-1 heading", async () => {
    await renderApp(harness());
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["Keelson"]);
  });

  test("every complementary landmark has an accessible name, the job column included", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    await screen.findByRole("region", { name: /job detail/i });

    const asides = [...document.querySelectorAll("aside")];
    expect(asides.map((aside) => aside.getAttribute("aria-label"))).toEqual([
      "Edit pipeline",
      "Job",
    ]);
  });
});

describe("the focus policy across panels", () => {
  afterEach(restoreViewport);

  test("opening the sidebar overlay moves focus into it, closing it returns to Panel", async () => {
    narrowViewport();
    await renderApp(harness());
    const trigger = screen.getByRole("button", { name: "Panel" });
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close panel" })),
    );

    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Panel" }));
  });

  test("Escape closes the sidebar overlay and returns focus to Panel", async () => {
    narrowViewport();
    await renderApp(harness());
    await userEvent.click(screen.getByRole("button", { name: "Panel" }));
    const sidebar = screen.getByRole("complementary", { name: "Edit pipeline" });
    expect(sidebar.className).not.toContain("max-lg:hidden");

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Panel" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Panel" }));
  });

  test("below lg, Tab stays inside the sidebar overlay", async () => {
    narrowViewport();
    await renderApp(harness());
    await userEvent.click(screen.getByRole("button", { name: "Panel" }));
    const sidebar = screen.getByRole("complementary", { name: "Edit pipeline" });
    for (let step = 0; step < 14; step += 1) {
      await userEvent.tab();
      expect(sidebar.contains(document.activeElement)).toBe(true);
    }
  });

  test("below lg, the job overlay takes focus on open and keeps Tab inside", async () => {
    narrowViewport();
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    const overlay = await screen.findByRole("complementary", { name: "Job" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close job detail" })),
    );
    for (let step = 0; step < 20; step += 1) {
      await userEvent.tab();
      expect(overlay.contains(document.activeElement)).toBe(true);
    }
  });

  test('"See tools" lands focus on the catalogue\'s layer filter, set to that layer', async () => {
    const uncovered = {
      ...DOCUMENT,
      coverage: {
        jobs: [],
        partial: false,
        layers: LAYERS.map((layer) => ({
          layer: layer.id,
          covered: false,
          jobs: [],
          services: [],
          ci: [],
        })),
      },
    };
    await renderApp(harness({ document: uncovered }));
    await userEvent.click(screen.getByRole("button", { name: "Coverage" }));
    const [first] = await screen.findAllByRole("button", { name: "See tools" });
    await userEvent.click(first as HTMLElement);

    const layer = await screen.findByLabelText("Layer");
    await waitFor(() => expect(document.activeElement).toBe(layer));
    expect((layer as HTMLSelectElement).value).not.toBe("any");
  });
});

describe("finding a job by name", () => {
  test("Ctrl+K opens the search with its field focused, Escape gives focus back", async () => {
    await renderApp(harness());
    await screen.findByRole("button", { name: /compile/ });
    const trigger = screen.getByRole("button", { name: "Find job" });
    trigger.focus();

    await userEvent.keyboard("{Control>}k{/Control}");
    const field = await screen.findByRole("combobox", { name: "Find a job" });
    expect(document.activeElement).toBe(field);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Find a job" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("typing narrows the list, prefix matches first, and says when nothing matches", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: "Find job" }));

    await userEvent.keyboard("i");
    const options = () =>
      within(screen.getByRole("listbox", { name: "Jobs" }))
        .queryAllByRole("option")
        .map((option) => option.getAttribute("data-job"));
    expect(options()).toEqual(["compile", "unit"]);
    await userEvent.keyboard("{Backspace}un");
    expect(options()).toEqual(["unit"]);
    await userEvent.keyboard("zz");
    expect(options()).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("No job matches unzz.");
  });

  test("the arrows move the active option, Enter opens that job and focuses its node", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: "Find job" }));
    const field = screen.getByRole("combobox", { name: "Find a job" });

    expect(
      document.getElementById(field.getAttribute("aria-activedescendant") ?? "")?.dataset.job,
    ).toBe("compile");
    await userEvent.keyboard("{ArrowDown}");
    expect(
      document.getElementById(field.getAttribute("aria-activedescendant") ?? "")?.dataset.job,
    ).toBe("unit");
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByRole("region", { name: /job detail/i })).toBeDefined();
    expect(screen.getByRole("region", { name: /job detail/i }).textContent).toContain("unit");
    expect(screen.queryByRole("combobox", { name: "Find a job" })).toBeNull();
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.jobId).toBe("unit"));
  });

  test("a click on an option opens that job", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: "Find job" }));
    await userEvent.click(screen.getByRole("option", { name: /compile/ }));
    expect(screen.getByRole("region", { name: /job detail/i }).textContent).toContain("compile");
  });

  test("the slash key opens it too, but not while typing in a field", async () => {
    await renderApp(harness());
    await screen.findByRole("button", { name: /compile/ });
    screen.getByRole("textbox", { name: "New stage name" }).focus();
    await userEvent.keyboard("/");
    expect(screen.queryByRole("combobox", { name: "Find a job" })).toBeNull();

    screen.getByRole("button", { name: "Find job" }).focus();
    await userEvent.keyboard("/");
    expect(screen.getByRole("combobox", { name: "Find a job" })).toBeDefined();
  });
});

describe("the table display, legible at any zoom", () => {
  test("Table replaces the graph with one row per job, in stage order, and back", async () => {
    await renderApp(harness());
    await screen.findByRole("button", { name: /compile/ });
    const display = screen.getByRole("group", { name: "Display" });
    expect(
      within(display).getByRole("button", { name: "Graph" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await userEvent.click(within(display).getByRole("button", { name: "Table" }));

    const table = screen.getByRole("table", { name: "Pipeline jobs" });
    expect(screen.queryByRole("region", { name: "Pipeline graph" })).toBeNull();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "compile",
      "unit",
    ]);
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")[1]?.textContent).toBe("test");
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")[2]?.textContent).toBe("compile");
    expect(within(rows[0] as HTMLElement).getAllByRole("cell")[2]?.textContent).toBe("None");

    await userEvent.click(within(display).getByRole("button", { name: "Graph" }));
    expect(await screen.findByRole("region", { name: "Pipeline graph" })).toBeDefined();
  });

  test("a row opens its job, and closing the panel returns focus to that row", async () => {
    await renderApp(harness());
    await screen.findByRole("button", { name: /compile/ });
    await userEvent.click(screen.getByRole("button", { name: "Table" }));

    const row = screen.getByRole("button", { name: "unit" });
    await userEvent.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: /job detail/i }).textContent).toContain("unit");

    await userEvent.click(screen.getByRole("button", { name: "Close job detail" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "unit" })),
    );
  });

  test("on the Coverage view, each row lists its layers", async () => {
    const covered = {
      ...DOCUMENT,
      coverage: {
        jobs: [{ job: "unit", layers: ["sast" as const], tools: [], overridden: false }],
        partial: false,
        layers: [],
      },
    };
    await renderApp(harness({ document: covered }));
    await userEvent.click(screen.getByRole("button", { name: "Coverage" }));
    await userEvent.click(screen.getByRole("button", { name: "Table" }));

    const table = screen.getByRole("table", { name: "Pipeline jobs" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Job", "Stage", "Needs", "Layers"]);
    const unit = within(table).getAllByRole("row")[2] as HTMLElement;
    expect(within(unit).getAllByRole("cell")[3]?.textContent).toContain(findLayer("sast").short);
  });
});
