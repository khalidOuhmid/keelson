import { describe, expect, test } from "bun:test";
import type { Need, Pipeline } from "@keelson/core";
import { type LayoutMetrics, layoutPipeline } from "../src/views/pipeline/layout.ts";

const METRICS: LayoutMetrics = {
  nodeWidth: 200,
  nodeHeight: 64,
  columnGap: 80,
  rowGap: 24,
};

function need(job: string, optional = false): Need {
  return { job, optional, artifacts: true };
}

function pipeline(
  stages: string[],
  jobs: { id: string; stage: string; needs?: Need[] }[],
  implicit = false,
): Pipeline {
  return {
    stages: stages.map((name, index) => ({
      name,
      implicit,
      range: implicit ? null : { start: index * 10, end: index * 10 + name.length },
    })),
    jobs: jobs.map((job, index) => ({
      id: job.id,
      stage: { value: job.stage, origin: { kind: "local" } },
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

const SAMPLE = pipeline(
  ["build", "test", "deploy"],
  [
    { id: "compile", stage: "build" },
    { id: "unit", stage: "test", needs: [need("compile")] },
    { id: "lint", stage: "test" },
    { id: "ship", stage: "deploy", needs: [need("unit"), need("lint", true)] },
  ],
);

describe("colonnes", () => {
  test("une colonne par stage, dans l'ordre des stages", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.columns.map((column) => column.name)).toEqual(["build", "test", "deploy"]);
  });

  test("chaque colonne porte les jobs de son stage", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.columns.map((column) => column.jobIds)).toEqual([
      ["compile"],
      ["unit", "lint"],
      ["ship"],
    ]);
  });

  test("les colonnes se suivent de gauche à droite", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const xs = layout.columns.map((column) => column.x);
    expect(xs).toEqual([...xs].sort((left, right) => left - right));
    expect(new Set(xs).size).toBe(xs.length);
  });

  test("un stage sans job garde sa colonne", async () => {
    const layout = await layoutPipeline(
      pipeline(["build", "vide", "test"], [{ id: "a", stage: "build" }]),
      METRICS,
    );
    expect(layout.columns.map((column) => column.name)).toEqual(["build", "vide", "test"]);
    expect(layout.columns[1]?.jobIds).toEqual([]);
  });

  test("les stages implicites sont signalés", async () => {
    const layout = await layoutPipeline(
      pipeline([".pre", "build"], [{ id: "a", stage: "build" }], true),
      METRICS,
    );
    expect(layout.columns.map((column) => column.implicit)).toEqual([true, true]);
  });

  test("un job dans un stage non déclaré est rangé dans une colonne de fin", async () => {
    const layout = await layoutPipeline(
      pipeline(
        ["build"],
        [
          { id: "a", stage: "build" },
          { id: "orphelin", stage: "inconnu" },
        ],
      ),
      METRICS,
    );
    const last = layout.columns.at(-1);
    expect(last?.jobIds).toEqual(["orphelin"]);
    expect(last?.name).toBe("inconnu");
  });
});

describe("nœuds", () => {
  test("un nœud par job, aux dimensions demandées", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.nodes).toHaveLength(4);
    for (const node of layout.nodes) {
      expect(node.width).toBe(METRICS.nodeWidth);
      expect(node.height).toBe(METRICS.nodeHeight);
    }
  });

  test("les nœuds d'un même stage partagent la même abscisse", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const inTest = layout.nodes.filter((node) => ["unit", "lint"].includes(node.id));
    expect(inTest).toHaveLength(2);
    expect(inTest[0]?.x).toBe(inTest[1]?.x ?? -1);
  });

  test("les nœuds d'un même stage ne se chevauchent pas verticalement", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const inTest = layout.nodes
      .filter((node) => ["unit", "lint"].includes(node.id))
      .sort((left, right) => left.y - right.y);
    const [first, second] = inTest;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first !== undefined && second !== undefined) {
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    }
  });

  test("un stage ultérieur est à droite d'un stage antérieur", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const compile = byId.get("compile");
    const ship = byId.get("ship");
    expect(compile).toBeDefined();
    expect(ship).toBeDefined();
    if (compile !== undefined && ship !== undefined) {
      expect(ship.x).toBeGreaterThan(compile.x);
    }
  });

  test("un pipeline sans job rend une liste de nœuds vide", async () => {
    const layout = await layoutPipeline(pipeline(["build"], []), METRICS);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
});

describe("arêtes", () => {
  test("une arête par need", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.edges).toHaveLength(3);
  });

  test("chaque arête relie la cible du need au job qui en dépend", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const pairs = layout.edges.map((edge) => `${edge.source}->${edge.target}`).sort();
    expect(pairs).toEqual(["compile->unit", "lint->ship", "unit->ship"]);
  });

  test("un need optionnel est marqué", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const optional = layout.edges.filter((edge) => edge.optional);
    expect(optional).toHaveLength(1);
    expect(optional[0]?.source).toBe("lint");
  });

  test("un job sans needs n'a aucune arête entrante", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.edges.some((edge) => edge.target === "compile")).toBe(false);
    expect(layout.edges.some((edge) => edge.target === "lint")).toBe(false);
  });

  test("un need vers un job inexistant ne crée pas d'arête", async () => {
    const layout = await layoutPipeline(
      pipeline(["build"], [{ id: "a", stage: "build", needs: [need("fantome")] }]),
      METRICS,
    );
    expect(layout.edges).toEqual([]);
  });

  test("les identifiants d'arête sont uniques", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const ids = layout.edges.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("déterminisme", () => {
  test("deux mises en page de la même IR sont identiques", async () => {
    const [first, second] = await Promise.all([
      layoutPipeline(SAMPLE, METRICS),
      layoutPipeline(SAMPLE, METRICS),
    ]);
    expect(second).toEqual(first);
  });

  test("dix mises en page successives sont identiques", async () => {
    const reference = await layoutPipeline(SAMPLE, METRICS);
    for (let index = 0; index < 9; index += 1) {
      expect(await layoutPipeline(SAMPLE, METRICS)).toEqual(reference);
    }
  });

  test("des métriques différentes donnent des positions différentes", async () => {
    const serre = await layoutPipeline(SAMPLE, METRICS);
    const large = await layoutPipeline(SAMPLE, { ...METRICS, columnGap: 400 });
    expect(large).not.toEqual(serre);
  });

  test("la mise en page ne dépend pas de l'ordre des jobs dans l'IR", async () => {
    const reordered = pipeline(
      ["build", "test", "deploy"],
      [
        { id: "ship", stage: "deploy", needs: [need("unit"), need("lint", true)] },
        { id: "lint", stage: "test" },
        { id: "unit", stage: "test", needs: [need("compile")] },
        { id: "compile", stage: "build" },
      ],
    );
    const layout = await layoutPipeline(reordered, METRICS);
    const byId = new Map(layout.nodes.map((node) => [node.id, node.x]));
    const reference = await layoutPipeline(SAMPLE, METRICS);
    const referenceById = new Map(reference.nodes.map((node) => [node.id, node.x]));
    expect(byId.get("compile")).toBe(referenceById.get("compile"));
    expect(byId.get("ship")).toBe(referenceById.get("ship"));
  });
});
