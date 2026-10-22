import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Operation, Pipeline } from "@keelson/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiResult, DocumentPayload, OperationPayload } from "../src/api/client.ts";
import type { ServerEvent } from "../src/api/events.ts";
import { App, type AppDeps } from "../src/app.tsx";
import { LAYOUT_TOKENS } from "../src/views/pipeline/metrics.ts";

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
    stages: ["build", "test"].map((name) => ({ name, implicit: false, range: null })),
    jobs: [
      {
        id: "compile",
        stage: { value: "build", origin: { kind: "local" } },
        needs: null,
        environment: null,
        extends: [],
        opaque: [],
        range: { start: 0, end: 20 },
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
        range: { start: 20, end: 60 },
      },
    ],
    templates: [],
    opaque: [],
  };
}

const DOCUMENT: DocumentPayload = {
  text: "stages:\n  - build\n  - test\n",
  pipeline: pipeline(),
  diagnostics: [],
  hash: HASH,
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
    pipeline: pipeline(),
    diagnostics: [],
    hash: NEXT,
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
        document: async () =>
          documents.shift() ?? { ok: true, value: options.document ?? DOCUMENT },
        submit: async (_file, op, opId) => {
          submitted.push({ op, opId });
          return submits.shift() ?? { ok: true, value: ok };
        },
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

describe("chargement", () => {
  test("charge le workspace puis le premier document", async () => {
    await renderApp(harness());
    expect(await screen.findByRole("button", { name: /compile/ })).toBeDefined();
  });

  test("affiche l'état vide quand aucun fichier CI n'est détecté", async () => {
    render(<App deps={harness({ files: [] }).deps} />);
    expect(await screen.findByRole("heading", { name: /no ci file/i })).toBeDefined();
  });

  test("nomme le fichier chargé", async () => {
    await renderApp(harness());
    expect(screen.getByText(".gitlab-ci.yml")).toBeDefined();
  });
});

describe("abonnement aux événements", () => {
  test("s'abonne une fois au montage", async () => {
    const h = harness();
    await renderApp(h);
    expect(h.subscriptions).toBe(1);
  });

  test("ferme l'abonnement au démontage", async () => {
    const h = harness();
    const view = await renderApp(h);
    view.unmount();
    expect(h.closed).toBe(1);
  });

  test("un document.changed recharge et le dit", async () => {
    const h = harness();
    await renderApp(h);
    h.emit({ kind: "document.changed", file: ".gitlab-ci.yml", hash: NEXT });
    expect(await screen.findByText(/changed on disk/i)).toBeDefined();
  });

  test("un document.removed affiche l'état supprimé", async () => {
    const h = harness();
    await renderApp(h);
    h.emit({ kind: "document.removed", file: ".gitlab-ci.yml" });
    expect(await screen.findByRole("heading", { name: /deleted/i })).toBeDefined();
  });
});

describe("sélection et panneaux", () => {
  test("cliquer un job ouvre son panneau de détail", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    expect(await screen.findByRole("region", { name: /job detail/i })).toBeDefined();
  });

  test("le panneau montre le badge d'origine du job sélectionné", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    const panel = await screen.findByRole("region", { name: /job detail/i });
    expect(panel.textContent).toContain("inherited from .base");
  });

  test("aucun panneau de détail sans sélection", async () => {
    await renderApp(harness());
    expect(screen.queryByRole("region", { name: /job detail/i })).toBeNull();
  });

  test("le panneau de diagnostics est toujours présent", async () => {
    await renderApp(harness());
    expect(screen.getByRole("region", { name: /diagnostics/i })).toBeDefined();
  });
});

describe("édition", () => {
  test("une action d'édition envoie une opération avec le hash courant", async () => {
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

  test("après une opération réussie, Undo devient actif", async () => {
    const h = harness();
    await renderApp(h);
    expect(screen.getByRole("button", { name: /undo/i }).hasAttribute("disabled")).toBe(true);

    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /undo/i }).hasAttribute("disabled")).toBe(false),
    );
  });

  test("Undo renvoie l'inverse au serveur", async () => {
    const h = harness();
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    await waitFor(() => expect(h.submitted).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(h.submitted).toHaveLength(2));
    expect(h.submitted[1]?.op.kind).toBe("splice");
  });

  test("le message d'erreur du serveur est affiché tel quel", async () => {
    const h = harness();
    h.queueSubmit({
      ok: false,
      error: { status: 422, code: "STAGE_EXISTS", message: "le stage existe déjà" },
    });
    await renderApp(h);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "test");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));

    expect(await screen.findByText("le stage existe déjà")).toBeDefined();
    expect(await screen.findByText("STAGE_EXISTS")).toBeDefined();
  });

  test("un 409 recharge, vide les piles et dit que l'opération n'a pas été appliquée", async () => {
    const h = harness();
    h.queueSubmit({
      ok: false,
      error: { status: 409, code: "STALE_DOCUMENT", message: "périmé", hash: NEXT },
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

describe("YAML invalide", () => {
  const broken: DocumentPayload = {
    ...DOCUMENT,
    diagnostics: [{ code: "INVALID_YAML", severity: "error", message: "indentation", range: null }],
  };

  test("affiche l'état invalide et désactive l'édition", async () => {
    render(<App deps={harness({ document: broken }).deps} />);
    expect(await screen.findByRole("heading", { name: /cannot be parsed/i })).toBeDefined();
  });

  test("aucun formulaire d'édition n'est proposé", async () => {
    render(<App deps={harness({ document: broken }).deps} />);
    await screen.findByRole("heading", { name: /cannot be parsed/i });
    expect(screen.queryByRole("textbox", { name: /new stage name/i })).toBeNull();
  });
});
