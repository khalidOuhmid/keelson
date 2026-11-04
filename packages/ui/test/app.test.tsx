import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Operation, Pipeline } from "@keelson/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiResult, DocumentPayload, OperationPayload } from "../src/api/client.ts";
import type { ServerEvent } from "../src/api/events.ts";
import { App, type AppDeps } from "../src/app.tsx";
import { LAYOUT_TOKENS } from "../src/views/pipeline/metrics.ts";

const MAIN = ".gitlab-ci.yml";

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

  test("l'erreur du serveur est rendue en anglais depuis son code et ses params", async () => {
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

  test("un 409 recharge, vide les piles et dit que l'opération n'a pas été appliquée", async () => {
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

describe("YAML invalide", () => {
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

describe("l'éditeur suit le job sélectionné", () => {
  /** Trouvé par /impeccable critique le 2026-10-22 : `JobEditor` était monté sans `key`, donc son
   *  état local survivait au changement de sélection et `Rename` soumettait un nom que
   *  l'utilisateur n'avait jamais tapé. Classe corruption de fichier. */
  test("les champs reflètent le nouveau job, pas le précédent", async () => {
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

  test("renommer après un changement de sélection soumet le job affiché", async () => {
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

describe("invariants de mise en page, sur le rendu", () => {
  /** Règle « invariants de mise en page » : la cohérence entre l'IR et l'affichage se teste sur le
   *  rendu, pas seulement sur les coordonnées. Les tests de `layout.test.ts` n'auraient pas vu une
   *  régression du rendu lui-même — c'est une capture qui avait trouvé `lint` dans `build`. */
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

  /** `lint` est sans arête, dans un stage tardif : c'est la forme exacte qui faisait atterrir un
   *  job dans la colonne du stage précédent. Le pipeline du harnais, tout en arêtes, ne la
   *  reproduit pas et laisserait ces tests verts par construction. */
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

  /** Le stage est lu dans la description accessible du nœud, pas dans l'IR : c'est ce que le lecteur
   *  d'écran annonce et ce que l'utilisateur lit sous le titre. L'invariant compare donc l'affichage
   *  à lui-même, et non le calcul à lui-même. */
  function announcedStage(id: string): string {
    const description = document.getElementById(`job-${id}-description`)?.textContent ?? "";
    return /Stage ([^.]+)\./.exec(description)?.[1] ?? "";
  }

  test("chaque job rendu tombe dans la colonne du stage qu'il annonce", async () => {
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

  test("le compte de l'en-tête égale le nombre de jobs rendus dans la colonne", async () => {
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

describe("bannières et opération en vol, sur le rendu", () => {
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

  test("le bouton Dismiss ferme réellement la bannière d'erreur", async () => {
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

  test("une opération en vol désactive les contrôles d'édition et est annoncée", async () => {
    const { h, release } = deferredHarness();
    await renderApp(h);

    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");

    // Le clic n'est pas attendu tout de suite : `act` attendrait la soumission, qu'on retient
    // justement en vol. Il est attendu après la libération, pour ne pas fuir d'un test à l'autre.
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

describe("fermeture du panneau de détail au clavier", () => {
  /** Trouvé par /impeccable critique le 2026-10-22 : `onSelectJob(null)` n'était atteignable que
   *  par un clic souris sur le fond du canevas. Aucun utilisateur au clavier ne pouvait refermer le
   *  panneau, et quinze contrôles restaient définitivement dans son cycle de tabulation. */
  test("Échap referme le panneau", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    expect(await screen.findByRole("region", { name: /job detail/i })).toBeDefined();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: /job detail/i })).toBeNull());
  });

  test("le panneau porte un bouton de fermeture", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));

    await userEvent.click(screen.getByRole("button", { name: "Close job detail" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /job detail/i })).toBeNull());
  });
});

describe("la barre latérale est groupée", () => {
  /** La critique du 2026-10-22 : douze contrôles de deux tâches sans rapport se suivaient sur une
   *  surface indifférenciée, et `LABEL` servait indistinctement de titre de section et d'étiquette
   *  de champ — une seule voix, donc aucune hiérarchie. */
  test("deux sections nommées, l'une pour les stages, l'autre pour la création de job", async () => {
    await renderApp(harness());

    expect(screen.getByRole("group", { name: "Stages" })).toBeDefined();
    expect(screen.getByRole("group", { name: "New job" })).toBeDefined();
  });

  test("le titre de section ne se confond pas avec une étiquette de champ", async () => {
    await renderApp(harness());

    const heading = screen.getByText("Stages");
    const label = screen.getByText("New stage name");
    expect(heading.className).not.toBe(label.className);
  });
});

describe("le focus ne tombe jamais sur le corps du document", () => {
  /** Revue indépendante : après Échap comme après une suppression confirmée, `document.activeElement`
   *  était `<body>`. Quand le panneau de détail disparaît, le focus revient au graphe. */
  test("fermer le panneau rend le focus au graphe", async () => {
    await renderApp(harness());
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    await screen.findByRole("region", { name: /job detail/i });

    await userEvent.click(screen.getByRole("button", { name: "Close job detail" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("region", { name: "Pipeline graph" })),
    );
  });
});

describe("suppression confirmée : focus et sélection", () => {
  /** Seconde revue : l'effet de refocalisation se déclenchait sur `selectedJobId`, que
   *  `applyPayload` ne remet jamais à `null`. Après une suppression confirmée, le panneau
   *  disparaissait mais l'effet ne tirait pas, et le focus retombait sur `<body>` — au moment où
   *  le produit vient de réécrire le fichier. Le commentaire du code affirmait l'inverse. */
  function withoutUnit() {
    const base = pipeline();
    return { ...base, jobs: base.jobs.filter((candidate) => candidate.id !== "compile") };
  }

  test("le focus revient au graphe et la sélection est libérée", async () => {
    const h = harness();
    h.queueSubmit({
      ok: true,
      value: {
        text: DOCUMENT_TEXT,
        pipeline: withoutUnit(),
        diagnostics: [],
        hash: NEXT,
        included: {},
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

describe("Échap dans la confirmation n'atteint pas le panneau", () => {
  /** Seconde revue : le `stopPropagation` du dialogue n'était couvert que par un test qui monte
   *  `JobEditor` seul, donc sans l'écouteur de document d'`app.tsx`. Le retirer ne faisait rougir
   *  aucun test. Celui-ci monte l'application entière. */
  test("Échap ferme le dialogue et laisse le panneau ouvert", async () => {
    await renderApp(harness());

    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    expect(screen.getByRole("alertdialog")).toBeDefined();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("region", { name: /job detail/i })).toBeDefined();
  });
});
