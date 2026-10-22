import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Environment, Need, Origin, Pipeline } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LAYOUT_TOKENS } from "../../src/views/pipeline/metrics.ts";
import { describeOrigin } from "../../src/views/pipeline/origin.ts";
import { PipelineCanvas } from "../../src/views/pipeline/PipelineCanvas.tsx";

beforeEach(() => {
  document.documentElement.style.setProperty(LAYOUT_TOKENS.nodeWidth, "200px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.nodeHeight, "64px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.columnGap, "72px");
  document.documentElement.style.setProperty(LAYOUT_TOKENS.rowGap, "20px");
});

afterEach(cleanup);

function descriptionOf(element: HTMLElement): string {
  const id = element.getAttribute("aria-describedby");
  return id === null ? "" : (document.getElementById(id)?.textContent ?? "");
}

function need(job: string, optional = false): Need {
  return { job, optional, artifacts: true };
}

type JobSpec = {
  id: string;
  stage: string;
  stageOrigin?: Origin;
  needs?: Need[];
  needsOrigin?: Origin;
  environment?: Environment;
  extends?: string[];
};

function pipeline(stages: { name: string; implicit?: boolean }[], jobs: JobSpec[]): Pipeline {
  return {
    stages: stages.map((stage) => ({
      name: stage.name,
      implicit: stage.implicit ?? false,
      range: null,
    })),
    jobs: jobs.map((job, index) => ({
      id: job.id,
      stage: { value: job.stage, origin: job.stageOrigin ?? { kind: "local" } },
      needs:
        job.needs === undefined
          ? null
          : { value: job.needs, origin: job.needsOrigin ?? { kind: "local" } },
      environment:
        job.environment === undefined
          ? null
          : { value: job.environment, origin: { kind: "local" } },
      extends: job.extends ?? [],
      opaque: [],
      range: { start: index * 100, end: index * 100 + 50 },
    })),
    templates: [],
    opaque: [],
  };
}

const SAMPLE = pipeline(
  [{ name: "build" }, { name: "test" }, { name: "deploy" }],
  [
    { id: "compile", stage: "build" },
    { id: "unit", stage: "test", needs: [need("compile")] },
    { id: "lint", stage: "test" },
    { id: "ship", stage: "deploy", needs: [need("unit"), need("lint", true)] },
  ],
);

async function renderCanvas(
  value: Pipeline,
  options: { selectedJobId?: string | null; onSelect?: (id: string | null) => void } = {},
) {
  const view = render(
    <PipelineCanvas
      pipeline={value}
      selectedJobId={options.selectedJobId ?? null}
      onSelectJob={options.onSelect ?? (() => undefined)}
    />,
  );
  await screen.findByRole("region", { name: /pipeline/i });
  return view;
}

describe("describeOrigin", () => {
  test("une valeur locale n'a pas de badge", () => {
    expect(describeOrigin({ kind: "local" })).toBeNull();
  });

  test("un extends nomme son template", () => {
    expect(describeOrigin({ kind: "extends", template: ".base" })).toBe("inherited from .base");
  });

  test("un défaut est annoncé comme tel", () => {
    expect(describeOrigin({ kind: "default" })).toBe("default");
  });

  test("un anchor nomme son ancre", () => {
    expect(describeOrigin({ kind: "anchor", name: "defaults" })).toBe("from anchor &defaults");
  });

  test("un !reference nomme son chemin", () => {
    expect(describeOrigin({ kind: "reference", path: [".needs", "common"] })).toBe(
      "from !reference [.needs, common]",
    );
  });
});

describe("colonnes de stages", () => {
  test("une colonne par stage, dans l'ordre des stages", async () => {
    await renderCanvas(SAMPLE);
    const headers = await screen.findAllByTestId("stage-column-name");
    expect(headers.map((element) => element.textContent)).toEqual(["build", "test", "deploy"]);
  });

  test("chaque colonne annonce son nombre de jobs", async () => {
    await renderCanvas(SAMPLE);
    const column = await screen.findByRole("region", { name: /stage test/i });
    expect(column.textContent).toContain("2");
  });

  test("un stage implicite est signalé", async () => {
    await renderCanvas(
      pipeline([{ name: "build", implicit: true }], [{ id: "a", stage: "build" }]),
    );
    expect(await screen.findByText(/implicit/i)).toBeDefined();
  });

  test("un stage déclaré n'est pas signalé comme implicite", async () => {
    await renderCanvas(SAMPLE);
    expect(screen.queryByText(/implicit/i)).toBeNull();
  });
});

describe("nœuds de jobs", () => {
  test("un bouton par job, nommé par son identifiant", async () => {
    await renderCanvas(SAMPLE);
    for (const id of ["compile", "unit", "lint", "ship"]) {
      expect(await screen.findByRole("button", { name: new RegExp(id) })).toBeDefined();
    }
  });

  test("le nœud affiche son stage", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /compile/ });
    expect(node.textContent).toContain("build");
  });

  test("le nœud décrit ses dépendances via aria-describedby", async () => {
    await renderCanvas(SAMPLE);
    const description = descriptionOf(await screen.findByRole("button", { name: /ship/ }));
    expect(description).toContain("unit");
    expect(description).toContain("lint");
    expect(description.toLowerCase()).toContain("optional");
  });

  test("aucun nœud n'utilise aria-description, insuffisamment supporté", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /ship/ });
    expect(node.getAttribute("aria-description")).toBeNull();
    expect(node.getAttribute("aria-describedby")).not.toBeNull();
  });

  test("l'élément décrivant le nœud est visuellement masqué mais présent dans le DOM", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /ship/ });
    const target = document.getElementById(node.getAttribute("aria-describedby") ?? "");
    expect(target).not.toBeNull();
    expect(target?.className).toContain("sr-only");
  });

  test("chaque nœud pointe vers son propre élément de description", async () => {
    await renderCanvas(SAMPLE);
    const ship = await screen.findByRole("button", { name: /ship/ });
    const compile = await screen.findByRole("button", { name: /compile/ });
    expect(ship.getAttribute("aria-describedby")).not.toBe(
      compile.getAttribute("aria-describedby"),
    );
  });

  test("un job sans dépendance le dit", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /compile/ });
    expect(descriptionOf(node).toLowerCase()).toContain("no dependencies");
  });

  test("le job sélectionné est marqué", async () => {
    await renderCanvas(SAMPLE, { selectedJobId: "unit" });
    const selected = await screen.findByRole("button", { name: /unit/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    const other = await screen.findByRole("button", { name: /compile/ });
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("badges d'origine", () => {
  test("un stage hérité d'un extends porte son badge", async () => {
    await renderCanvas(
      pipeline(
        [{ name: "build" }],
        [{ id: "a", stage: "build", stageOrigin: { kind: "extends", template: ".base" } }],
      ),
    );
    expect(await screen.findByText("inherited from .base")).toBeDefined();
  });

  test("un stage venu du défaut porte le badge default", async () => {
    await renderCanvas(
      pipeline([{ name: "test" }], [{ id: "a", stage: "test", stageOrigin: { kind: "default" } }]),
    );
    expect(await screen.findByText("default")).toBeDefined();
  });

  test("un stage local ne porte aucun badge", async () => {
    await renderCanvas(pipeline([{ name: "build" }], [{ id: "a", stage: "build" }]));
    expect(screen.queryByTestId("origin-badge")).toBeNull();
  });

  test("le badge est annoncé comme une information d'origine", async () => {
    await renderCanvas(
      pipeline(
        [{ name: "build" }],
        [{ id: "a", stage: "build", stageOrigin: { kind: "anchor", name: "defaults" } }],
      ),
    );
    const badge = await screen.findByTestId("origin-badge");
    expect(badge.getAttribute("title")?.toLowerCase()).toContain("override");
  });
});

describe("sélection", () => {
  test("un clic sur un nœud sélectionne son job", async () => {
    const selected: (string | null)[] = [];
    await renderCanvas(SAMPLE, { onSelect: (id) => selected.push(id) });
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    expect(selected).toEqual(["unit"]);
  });

  test("Entrée sur un nœud focalisé sélectionne son job", async () => {
    const selected: (string | null)[] = [];
    await renderCanvas(SAMPLE, { onSelect: (id) => selected.push(id) });
    const node = await screen.findByRole("button", { name: /lint/ });
    node.focus();
    await userEvent.keyboard("{Enter}");
    expect(selected).toEqual(["lint"]);
  });

  test("tous les nœuds sont atteignables au clavier", async () => {
    await renderCanvas(SAMPLE);
    for (const id of ["compile", "unit", "lint", "ship"]) {
      const node = await screen.findByRole("button", { name: new RegExp(id) });
      expect(node.getAttribute("tabindex")).not.toBe("-1");
    }
  });
});

describe("pipeline vide", () => {
  test("un pipeline sans job affiche un état vide explicite", async () => {
    await renderCanvas(pipeline([{ name: "build" }], []));
    expect(await screen.findByText(/no jobs/i)).toBeDefined();
  });

  test("un pipeline sans stage ni job reste rendu sans erreur", async () => {
    await renderCanvas(pipeline([], []));
    expect(await screen.findByRole("region", { name: /pipeline/i })).toBeDefined();
  });
});
