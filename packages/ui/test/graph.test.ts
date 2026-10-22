import { describe, expect, test } from "bun:test";
import type { Need, Origin, Pipeline } from "@keelson/core";
import { COLUMN_NODE_TYPE, JOB_NODE_TYPE, toFlowGraph } from "../src/views/pipeline/graph.ts";
import type { Layout } from "../src/views/pipeline/layout.ts";

function need(job: string, optional = false): Need {
  return { job, optional, artifacts: true };
}

function pipeline(
  stages: { name: string; implicit?: boolean }[],
  jobs: { id: string; stage: string; origin?: Origin; needs?: Need[] }[],
): Pipeline {
  return {
    stages: stages.map((stage) => ({
      name: stage.name,
      implicit: stage.implicit ?? false,
      range: null,
    })),
    jobs: jobs.map((job, index) => ({
      id: job.id,
      stage: { value: job.stage, origin: job.origin ?? { kind: "local" } },
      needs: job.needs === undefined ? null : { value: job.needs, origin: { kind: "local" } },
      environment: null,
      extends: [],
      opaque: [],
      range: { start: index * 100, end: index * 100 + 50 },
    })),
    templates: [],
    opaque: [],
  };
}

const LAYOUT: Layout = {
  nodes: [
    { id: "compile", x: 0, y: 0, width: 200, height: 64 },
    { id: "unit", x: 280, y: 0, width: 200, height: 64 },
    { id: "lint", x: 280, y: 88, width: 200, height: 64 },
  ],
  edges: [
    { id: "compile->unit", source: "compile", target: "unit", optional: false },
    { id: "lint->unit", source: "lint", target: "unit", optional: true },
  ],
  columns: [
    { name: "build", implicit: false, jobIds: ["compile"], x: 0, width: 200 },
    { name: "test", implicit: false, jobIds: ["unit", "lint"], x: 280, width: 200 },
  ],
  width: 480,
  height: 152,
};

const PIPELINE = pipeline(
  [{ name: "build" }, { name: "test" }],
  [
    { id: "compile", stage: "build" },
    { id: "unit", stage: "test", needs: [need("compile"), need("lint", true)] },
    { id: "lint", stage: "test" },
  ],
);

describe("nœuds de colonne", () => {
  test("une colonne par stage, avant les jobs dans l'ordre de rendu", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const columns = graph.nodes.filter((node) => node.type === COLUMN_NODE_TYPE);
    expect(columns.map((node) => node.data.name)).toEqual(["build", "test"]);
    expect(graph.nodes.indexOf(columns[0] as never)).toBeLessThan(
      graph.nodes.findIndex((node) => node.type === JOB_NODE_TYPE),
    );
  });

  test("les colonnes ne sont ni déplaçables ni sélectionnables", () => {
    for (const node of toFlowGraph(LAYOUT, PIPELINE, null).nodes.filter(
      (candidate) => candidate.type === COLUMN_NODE_TYPE,
    )) {
      expect(node.draggable).toBe(false);
      expect(node.selectable).toBe(false);
    }
  });

  test("une colonne porte son nombre de jobs et son caractère implicite", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const test = graph.nodes.find(
      (node) => node.type === COLUMN_NODE_TYPE && node.data.name === "test",
    );
    expect(test?.data.jobCount).toBe(2);
    expect(test?.data.implicit).toBe(false);
  });

  test("un stage implicite est signalé dans les données du nœud", () => {
    const implicite = toFlowGraph(
      { ...LAYOUT, columns: LAYOUT.columns.slice(0, 1).map((c) => ({ ...c, implicit: true })) },
      PIPELINE,
      null,
    ).nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    expect(implicite?.data.implicit).toBe(true);
  });

  test("les jobs sont décalés sous l'en-tête de colonne, qu'ils ne doivent pas recouvrir", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null, 32);
    const column = graph.nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    const job = graph.nodes.find((node) => node.type === JOB_NODE_TYPE);
    expect(column?.position.y).toBe(0);
    expect(job?.position.y).toBeGreaterThanOrEqual(32);
  });

  test("la colonne est assez haute pour contenir son en-tête et ses jobs", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null, 32);
    const column = graph.nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    expect(column?.height ?? 0).toBeGreaterThanOrEqual(LAYOUT.height + 32);
  });

  test("sans décalage demandé, les jobs gardent la position de la mise en page", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    expect(graph.nodes.find((node) => node.id === "unit")?.position).toEqual({ x: 280, y: 0 });
  });

  test("les colonnes sont sous les jobs", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const column = graph.nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    const job = graph.nodes.find((node) => node.type === JOB_NODE_TYPE);
    expect(column?.zIndex ?? 0).toBeLessThan(job?.zIndex ?? 0);
  });
});

describe("nœuds de job", () => {
  test("un nœud par job, positionné par la mise en page", () => {
    const jobs = toFlowGraph(LAYOUT, PIPELINE, null).nodes.filter(
      (node) => node.type === JOB_NODE_TYPE,
    );
    expect(jobs.map((node) => node.id)).toEqual(["compile", "unit", "lint"]);
    expect(jobs[1]?.position).toEqual({ x: 280, y: 0 });
  });

  test("le nœud porte son stage et l'origine de ce stage", () => {
    const graph = toFlowGraph(
      LAYOUT,
      pipeline(
        [{ name: "build" }, { name: "test" }],
        [
          { id: "compile", stage: "build", origin: { kind: "extends", template: ".base" } },
          { id: "unit", stage: "test" },
          { id: "lint", stage: "test" },
        ],
      ),
      null,
    );
    const compile = graph.nodes.find((node) => node.id === "compile");
    expect(compile?.data.stage).toBe("build");
    expect(compile?.data.stageOrigin).toEqual({ kind: "extends", template: ".base" });
  });

  test("le nœud liste ses needs avec leur caractère optionnel", () => {
    const unit = toFlowGraph(LAYOUT, PIPELINE, null).nodes.find((node) => node.id === "unit");
    expect(unit?.data.needs).toEqual([
      { job: "compile", optional: false },
      { job: "lint", optional: true },
    ]);
  });

  test("un job sans needs porte une liste vide", () => {
    const compile = toFlowGraph(LAYOUT, PIPELINE, null).nodes.find((node) => node.id === "compile");
    expect(compile?.data.needs).toEqual([]);
  });

  test("le job sélectionné est marqué", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, "unit");
    expect(graph.nodes.find((node) => node.id === "unit")?.data.selected).toBe(true);
    expect(graph.nodes.find((node) => node.id === "compile")?.data.selected).toBe(false);
  });

  test("un nœud sans entrée dans la mise en page est ignoré", () => {
    const graph = toFlowGraph({ ...LAYOUT, nodes: LAYOUT.nodes.slice(0, 1) }, PIPELINE, null);
    expect(
      graph.nodes.filter((node) => node.type === JOB_NODE_TYPE).map((node) => node.id),
    ).toEqual(["compile"]);
  });
});

describe("arêtes", () => {
  test("une arête par need, de la cible vers le dépendant", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["compile", "unit"],
      ["lint", "unit"],
    ]);
  });

  test("un need optionnel porte un style distinct", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const required = graph.edges.find((edge) => edge.id === "compile->unit");
    const optional = graph.edges.find((edge) => edge.id === "lint->unit");
    expect(required?.data?.optional).toBe(false);
    expect(optional?.data?.optional).toBe(true);
    expect(optional?.style?.strokeDasharray).toBeDefined();
    expect(required?.style?.strokeDasharray).toBeUndefined();
  });

  test("les arêtes du job sélectionné sont mises en avant", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, "unit");
    for (const edge of graph.edges) {
      expect(edge.data?.highlighted).toBe(true);
    }
  });

  test("les arêtes étrangères au job sélectionné ne le sont pas", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, "compile");
    expect(graph.edges.find((edge) => edge.id === "lint->unit")?.data?.highlighted).toBe(false);
    expect(graph.edges.find((edge) => edge.id === "compile->unit")?.data?.highlighted).toBe(true);
  });

  test("chaque arête est sélectionnable pour pouvoir être supprimée", () => {
    for (const edge of toFlowGraph(LAYOUT, PIPELINE, null).edges) {
      expect(edge.selectable).toBe(true);
    }
  });

  test("les arêtes portent un libellé accessible nommant les deux jobs", () => {
    const optional = toFlowGraph(LAYOUT, PIPELINE, null).edges.find(
      (edge) => edge.id === "lint->unit",
    );
    expect(optional?.ariaLabel).toContain("lint");
    expect(optional?.ariaLabel).toContain("unit");
    expect(optional?.ariaLabel?.toLowerCase()).toContain("optional");
  });
});

describe("pipeline vide", () => {
  test("aucun job ne produit aucun nœud de job", () => {
    const graph = toFlowGraph(
      { nodes: [], edges: [], columns: [], width: 0, height: 0 },
      pipeline([], []),
      null,
    );
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  test("des stages sans job gardent leurs colonnes", () => {
    const graph = toFlowGraph(
      {
        nodes: [],
        edges: [],
        columns: [{ name: "build", implicit: false, jobIds: [], x: 0, width: 200 }],
        width: 200,
        height: 0,
      },
      pipeline([{ name: "build" }], []),
      null,
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.data.jobCount).toBe(0);
  });
});
