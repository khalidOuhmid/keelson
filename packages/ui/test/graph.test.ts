import { describe, expect, test } from "bun:test";
import type { Need, Origin, Pipeline } from "@keelson/core";
import { COLUMN_NODE_TYPE, JOB_NODE_TYPE, toFlowGraph } from "../src/views/pipeline/graph.ts";
import type { Layout } from "../src/views/pipeline/layout.ts";

function need(job: string, optional = false): Need {
  return { job, optional, artifacts: true };
}

const MAIN = ".gitlab-ci.yml";

function pipeline(
  stages: { name: string; implicit?: boolean }[],
  jobs: { id: string; stage: string; origin?: Origin; needs?: Need[] }[],
): Pipeline {
  return {
    stages: stages.map((stage) => ({
      name: stage.name,
      implicit: stage.implicit ?? false,
      range: null,
      file: MAIN,
    })),
    jobs: jobs.map((job, index) => ({
      id: job.id,
      stage: { value: job.stage, origin: job.origin ?? { kind: "local" } },
      needs: job.needs === undefined ? null : { value: job.needs, origin: { kind: "local" } },
      environment: null,
      extends: [],
      opaque: [],
      signals: { image: null, script: [] },
      range: { start: index * 100, end: index * 100 + 50 },
      file: MAIN,
    })),
    templates: [],
    opaque: [],
    main: MAIN,
    files: [MAIN],
    unresolved: [],
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

describe("column nodes", () => {
  test("one column per stage, before the jobs in render order", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const columns = graph.nodes.filter((node) => node.type === COLUMN_NODE_TYPE);
    expect(columns.map((node) => node.data.name)).toEqual(["build", "test"]);
    expect(graph.nodes.indexOf(columns[0] as never)).toBeLessThan(
      graph.nodes.findIndex((node) => node.type === JOB_NODE_TYPE),
    );
  });

  test("columns are neither draggable nor selectable", () => {
    for (const node of toFlowGraph(LAYOUT, PIPELINE, null).nodes.filter(
      (candidate) => candidate.type === COLUMN_NODE_TYPE,
    )) {
      expect(node.draggable).toBe(false);
      expect(node.selectable).toBe(false);
    }
  });

  test("a column carries its job count and whether it is implicit", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const test = graph.nodes.find(
      (node) => node.type === COLUMN_NODE_TYPE && node.data.name === "test",
    );
    expect(test?.data.jobCount).toBe(2);
    expect(test?.data.implicit).toBe(false);
  });

  test("an implicit stage is flagged in the node data", () => {
    const implicite = toFlowGraph(
      { ...LAYOUT, columns: LAYOUT.columns.slice(0, 1).map((c) => ({ ...c, implicit: true })) },
      PIPELINE,
      null,
    ).nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    expect(implicite?.data.implicit).toBe(true);
  });

  test("jobs are offset below the column header, which they must not cover", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null, 32);
    const column = graph.nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    const job = graph.nodes.find((node) => node.type === JOB_NODE_TYPE);
    expect(column?.position.y).toBe(0);
    expect(job?.position.y).toBeGreaterThanOrEqual(32);
  });

  test("the column is tall enough to hold its header and its jobs", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null, 32);
    const column = graph.nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    expect(column?.height ?? 0).toBeGreaterThanOrEqual(LAYOUT.height + 32);
  });

  test("with no offset requested, jobs keep the layout position", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    expect(graph.nodes.find((node) => node.id === "unit")?.position).toEqual({ x: 280, y: 0 });
  });

  test("columns sit below the jobs", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const column = graph.nodes.find((node) => node.type === COLUMN_NODE_TYPE);
    const job = graph.nodes.find((node) => node.type === JOB_NODE_TYPE);
    expect(column?.zIndex ?? 0).toBeLessThan(job?.zIndex ?? 0);
  });
});

describe("job nodes", () => {
  test("one node per job, positioned by the layout", () => {
    const jobs = toFlowGraph(LAYOUT, PIPELINE, null).nodes.filter(
      (node) => node.type === JOB_NODE_TYPE,
    );
    expect(jobs.map((node) => node.id)).toEqual(["compile", "unit", "lint"]);
    expect(jobs[1]?.position).toEqual({ x: 280, y: 0 });
  });

  test("the node carries its stage and that stage's origin", () => {
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

  test("the node lists its needs and whether they are optional", () => {
    const unit = toFlowGraph(LAYOUT, PIPELINE, null).nodes.find((node) => node.id === "unit");
    expect(unit?.data.needs).toEqual([
      { job: "compile", optional: false },
      { job: "lint", optional: true },
    ]);
  });

  test("a job without needs carries an empty list", () => {
    const compile = toFlowGraph(LAYOUT, PIPELINE, null).nodes.find((node) => node.id === "compile");
    expect(compile?.data.needs).toEqual([]);
  });

  test("the selected job is marked", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, "unit");
    expect(graph.nodes.find((node) => node.id === "unit")?.data.selected).toBe(true);
    expect(graph.nodes.find((node) => node.id === "compile")?.data.selected).toBe(false);
  });

  test("a node with no layout entry is ignored", () => {
    const graph = toFlowGraph({ ...LAYOUT, nodes: LAYOUT.nodes.slice(0, 1) }, PIPELINE, null);
    expect(
      graph.nodes.filter((node) => node.type === JOB_NODE_TYPE).map((node) => node.id),
    ).toEqual(["compile"]);
  });
});

describe("edges", () => {
  test("one edge per need, from the target to the dependent", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["compile", "unit"],
      ["lint", "unit"],
    ]);
  });

  test("an optional need has a distinct style", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, null);
    const required = graph.edges.find((edge) => edge.id === "compile->unit");
    const optional = graph.edges.find((edge) => edge.id === "lint->unit");
    expect(required?.data?.optional).toBe(false);
    expect(optional?.data?.optional).toBe(true);
    expect(optional?.style?.strokeDasharray).toBeDefined();
    expect(required?.style?.strokeDasharray).toBeUndefined();
  });

  test("the selected job's edges are highlighted", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, "unit");
    for (const edge of graph.edges) {
      expect(edge.data?.highlighted).toBe(true);
    }
  });

  test("edges unrelated to the selected job are not", () => {
    const graph = toFlowGraph(LAYOUT, PIPELINE, "compile");
    expect(graph.edges.find((edge) => edge.id === "lint->unit")?.data?.highlighted).toBe(false);
    expect(graph.edges.find((edge) => edge.id === "compile->unit")?.data?.highlighted).toBe(true);
  });

  test("every edge is selectable so it can be deleted", () => {
    for (const edge of toFlowGraph(LAYOUT, PIPELINE, null).edges) {
      expect(edge.selectable).toBe(true);
    }
  });

  test("edges carry an accessible label naming both jobs", () => {
    const optional = toFlowGraph(LAYOUT, PIPELINE, null).edges.find(
      (edge) => edge.id === "lint->unit",
    );
    expect(optional?.ariaLabel).toContain("lint");
    expect(optional?.ariaLabel).toContain("unit");
    expect(optional?.ariaLabel?.toLowerCase()).toContain("optional");
  });
});

describe("empty pipeline", () => {
  test("no jobs produce no job nodes", () => {
    const graph = toFlowGraph(
      { nodes: [], edges: [], columns: [], height: 0 },
      pipeline([], []),
      null,
    );
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  test("stages without jobs keep their columns", () => {
    const graph = toFlowGraph(
      {
        nodes: [],
        edges: [],
        columns: [{ name: "build", implicit: false, jobIds: [], x: 0, width: 200 }],
        height: 0,
      },
      pipeline([{ name: "build" }], []),
      null,
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.data.jobCount).toBe(0);
  });
});

describe("the highlighted edge is visible", () => {
  /** `EdgeData.highlighted` was computed and tested, and consumed by no component: edges
   *  rendered with the library's default stroke and selection had no visual effect on them.
   *  The render test boundary rule forbids that — wire it or remove it. */
  test("selection changes stroke and weight, through tokens", () => {
    const selected = toFlowGraph(LAYOUT, PIPELINE, "lint");
    const highlighted = selected.edges.find((edge) => edge.data?.highlighted === true);
    const plain = selected.edges.find((edge) => edge.data?.highlighted !== true);

    expect(highlighted?.style).toMatchObject({
      stroke: "var(--color-accent)",
      strokeWidth: "var(--keelson-edge-width-strong)",
    });
    expect(plain?.style).toMatchObject({
      stroke: "var(--color-border-strong)",
      strokeWidth: "var(--keelson-edge-width)",
    });
  });
});
