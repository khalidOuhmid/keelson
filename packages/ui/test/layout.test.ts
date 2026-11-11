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

const MAIN = ".gitlab-ci.yml";

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
      file: MAIN,
    })),
    jobs: jobs.map((job, index) => ({
      id: job.id,
      stage: { value: job.stage, origin: { kind: "local" } },
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

const SAMPLE = pipeline(
  ["build", "test", "deploy"],
  [
    { id: "compile", stage: "build" },
    { id: "unit", stage: "test", needs: [need("compile")] },
    { id: "lint", stage: "test" },
    { id: "ship", stage: "deploy", needs: [need("unit"), need("lint", true)] },
  ],
);

describe("columns", () => {
  test("one column per stage, in stage order", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.columns.map((column) => column.name)).toEqual(["build", "test", "deploy"]);
  });

  test("each column holds the jobs of its stage", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.columns.map((column) => column.jobIds)).toEqual([
      ["compile"],
      ["unit", "lint"],
      ["ship"],
    ]);
  });

  test("columns follow each other from left to right", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const xs = layout.columns.map((column) => column.x);
    expect(xs).toEqual([...xs].sort((left, right) => left - right));
    expect(new Set(xs).size).toBe(xs.length);
  });

  test("a stage without jobs keeps its column", async () => {
    const layout = await layoutPipeline(
      pipeline(["build", "vide", "test"], [{ id: "a", stage: "build" }]),
      METRICS,
    );
    expect(layout.columns.map((column) => column.name)).toEqual(["build", "vide", "test"]);
    expect(layout.columns[1]?.jobIds).toEqual([]);
  });

  test("implicit stages are flagged", async () => {
    const layout = await layoutPipeline(
      pipeline([".pre", "build"], [{ id: "a", stage: "build" }], true),
      METRICS,
    );
    expect(layout.columns.map((column) => column.implicit)).toEqual([true, true]);
  });

  test("a job in an undeclared stage goes into a trailing column", async () => {
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

describe("nodes", () => {
  test("one node per job, at the requested size", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.nodes).toHaveLength(4);
    for (const node of layout.nodes) {
      expect(node.width).toBe(METRICS.nodeWidth);
      expect(node.height).toBe(METRICS.nodeHeight);
    }
  });

  test("nodes of the same stage share the same x", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const inTest = layout.nodes.filter((node) => ["unit", "lint"].includes(node.id));
    expect(inTest).toHaveLength(2);
    expect(inTest[0]?.x).toBe(inTest[1]?.x ?? -1);
  });

  test("nodes of the same stage do not overlap vertically", async () => {
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

  test("a later stage is to the right of an earlier one", async () => {
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

  test("a pipeline without jobs yields an empty node list", async () => {
    const layout = await layoutPipeline(pipeline(["build"], []), METRICS);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
});

describe("edges", () => {
  test("one edge per need", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.edges).toHaveLength(3);
  });

  test("each edge links the need's target to the job that depends on it", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const pairs = layout.edges.map((edge) => `${edge.source}->${edge.target}`).sort();
    expect(pairs).toEqual(["compile->unit", "lint->ship", "unit->ship"]);
  });

  test("an optional need is marked", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const optional = layout.edges.filter((edge) => edge.optional);
    expect(optional).toHaveLength(1);
    expect(optional[0]?.source).toBe("lint");
  });

  test("a job without needs has no incoming edge", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.edges.some((edge) => edge.target === "compile")).toBe(false);
    expect(layout.edges.some((edge) => edge.target === "lint")).toBe(false);
  });

  test("a need on a non-existent job creates no edge", async () => {
    const layout = await layoutPipeline(
      pipeline(["build"], [{ id: "a", stage: "build", needs: [need("fantome")] }]),
      METRICS,
    );
    expect(layout.edges).toEqual([]);
  });

  test("edge ids are unique", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    const ids = layout.edges.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("determinism", () => {
  test("two layouts of the same IR are identical", async () => {
    const [first, second] = await Promise.all([
      layoutPipeline(SAMPLE, METRICS),
      layoutPipeline(SAMPLE, METRICS),
    ]);
    expect(second).toEqual(first);
  });

  test("ten successive layouts are identical", async () => {
    const reference = await layoutPipeline(SAMPLE, METRICS);
    for (let index = 0; index < 9; index += 1) {
      expect(await layoutPipeline(SAMPLE, METRICS)).toEqual(reference);
    }
  });

  test("different metrics give different positions", async () => {
    const serre = await layoutPipeline(SAMPLE, METRICS);
    const large = await layoutPipeline(SAMPLE, { ...METRICS, columnGap: 400 });
    expect(large).not.toEqual(serre);
  });

  test("the layout does not depend on job order in the IR", async () => {
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

describe("invariant: a job is drawn in its stage's column", () => {
  /** ADR 0003 requires this invariant: the 2026-10-22 critique pass found `lint`, a `test`-stage
   *  job, drawn in the `build` column whose header announced "1 job". The existing tests checked
   *  that the layout is computed, never that it is true. */
  function assertContained(layout: Awaited<ReturnType<typeof layoutPipeline>>): void {
    const columnOf = new Map<string, (typeof layout.columns)[number]>();
    for (const column of layout.columns) {
      for (const id of column.jobIds) {
        columnOf.set(id, column);
      }
    }

    for (const node of layout.nodes) {
      const column = columnOf.get(node.id);
      expect(column).toBeDefined();
      if (column === undefined) {
        continue;
      }
      const centre = node.x + node.width / 2;
      expect({
        job: node.id,
        stage: column.name,
        inside: centre >= column.x && centre <= column.x + column.width,
      }).toEqual({ job: node.id, stage: column.name, inside: true });
    }
  }

  test("on a pipeline where one job has no edge", async () => {
    assertContained(
      await layoutPipeline(
        pipeline(
          ["build", "test", "scan", "deploy"],
          [
            { id: "build-image", stage: "build" },
            { id: "unit-tests", stage: "test", needs: [need("build-image")] },
            { id: "lint", stage: "test" },
            { id: "secret-detection", stage: "scan" },
            { id: "container-scan", stage: "scan", needs: [need("build-image")] },
            {
              id: "deploy-production",
              stage: "deploy",
              needs: [need("unit-tests"), need("secret-detection"), need("container-scan")],
            },
          ],
        ),
        METRICS,
      ),
    );
  });

  test("on a pipeline with no edges at all", async () => {
    assertContained(
      await layoutPipeline(
        pipeline(
          ["build", "test", "deploy"],
          [
            { id: "a", stage: "build" },
            { id: "b", stage: "test" },
            { id: "c", stage: "deploy" },
          ],
        ),
        METRICS,
      ),
    );
  });

  test("when a declared stage holds no job", async () => {
    assertContained(
      await layoutPipeline(
        pipeline(
          ["build", "vide", "deploy"],
          [
            { id: "a", stage: "build" },
            { id: "b", stage: "deploy", needs: [need("a")] },
          ],
        ),
        METRICS,
      ),
    );
  });

  test("when a job references an undeclared stage", async () => {
    assertContained(
      await layoutPipeline(
        pipeline(
          ["build"],
          [
            { id: "a", stage: "build" },
            { id: "b", stage: "surprise", needs: [need("a")] },
          ],
        ),
        METRICS,
      ),
    );
  });
});

describe("invariant: two jobs in the same column do not overlap", () => {
  async function overlapsIn(
    stages: string[],
    jobs: { id: string; stage: string; needs?: Need[] }[],
  ): Promise<string[]> {
    const layout = await layoutPipeline(pipeline(stages, jobs), METRICS);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const found: string[] = [];

    for (const column of layout.columns) {
      const placed = column.jobIds
        .map((id) => byId.get(id))
        .filter((node): node is NonNullable<typeof node> => node !== undefined)
        .sort((left, right) => left.y - right.y);

      for (const [index, node] of placed.entries()) {
        const next = placed[index + 1];
        if (next !== undefined && next.y < node.y + node.height) {
          found.push(`${node.id} overlaps ${next.id} in ${column.name}`);
        }
      }
    }

    return found;
  }

  test("on the dev fixture pipeline", async () => {
    expect(
      await overlapsIn(
        ["build", "test", "scan", "deploy"],
        [
          { id: "build-image", stage: "build" },
          { id: "unit-tests", stage: "test", needs: [need("build-image")] },
          { id: "lint", stage: "test" },
          { id: "secret-detection", stage: "scan" },
          { id: "container-scan", stage: "scan", needs: [need("build-image")] },
          {
            id: "deploy-production",
            stage: "deploy",
            needs: [need("unit-tests"), need("secret-detection"), need("container-scan")],
          },
        ],
      ),
    ).toEqual([]);
  });

  test("when a column mixes linked and isolated jobs", async () => {
    expect(
      await overlapsIn(
        ["build", "test"],
        [
          { id: "compile", stage: "build" },
          { id: "lié", stage: "test", needs: [need("compile")] },
          { id: "isolé-a", stage: "test" },
          { id: "isolé-b", stage: "test" },
        ],
      ),
    ).toEqual([]);
  });
});
