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
      pipeline(["build", "empty", "test"], [{ id: "a", stage: "build" }]),
      METRICS,
    );
    expect(layout.columns.map((column) => column.name)).toEqual(["build", "empty", "test"]);
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
          ["build", "empty", "deploy"],
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
          { id: "linked", stage: "test", needs: [need("compile")] },
          { id: "isolated-a", stage: "test" },
          { id: "isolated-b", stage: "test" },
        ],
      ),
    ).toEqual([]);
  });
});

describe("templates", () => {
  function withTemplates(): Pipeline {
    const base = pipeline(
      ["build", "deploy"],
      [
        { id: "image", stage: "build" },
        { id: "ship", stage: "deploy" },
        { id: "rollback", stage: "deploy" },
      ],
    );
    return {
      ...base,
      jobs: base.jobs.map((job) =>
        job.id === "image"
          ? { ...job, extends: [".docker"] }
          : { ...job, extends: [".deploy-base", ".missing"] },
      ),
      templates: [
        { id: ".docker", range: { start: 0, end: 1 }, file: MAIN, extends: [] },
        { id: ".deploy-base", range: { start: 2, end: 3 }, file: MAIN, extends: [] },
        { id: ".unused", range: { start: 4, end: 5 }, file: MAIN, extends: [] },
      ],
    };
  }

  test("each template gets a node, in file order, in a column upstream of the stages", async () => {
    const layout = await layoutPipeline(withTemplates(), METRICS);
    expect(layout.templates.map((node) => node.id)).toEqual([".docker", ".deploy-base", ".unused"]);
    const first = layout.columns[0]?.x ?? 0;
    for (const node of layout.templates) {
      expect(node.x + node.width).toBeLessThanOrEqual(first - METRICS.columnGap);
      expect(node.width).toBe(METRICS.nodeWidth);
    }
  });

  test("templates do not overlap, and the layout is tall enough for them", async () => {
    const layout = await layoutPipeline(withTemplates(), METRICS);
    const [a, b, c] = layout.templates;
    expect(b?.y).toBeGreaterThanOrEqual((a?.y ?? 0) + (a?.height ?? 0) + METRICS.rowGap);
    expect(c?.y).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.height ?? 0) + METRICS.rowGap);
    expect(layout.height).toBeGreaterThanOrEqual((c?.y ?? 0) + (c?.height ?? 0));
  });

  test("templates are not jobs: no stage column counts them", async () => {
    const layout = await layoutPipeline(withTemplates(), METRICS);
    expect(layout.columns.flatMap((column) => column.jobIds).sort()).toEqual([
      "image",
      "rollback",
      "ship",
    ]);
    expect(layout.nodes.map((node) => node.id)).not.toContain(".docker");
  });

  test("one inheritance edge per extends that names a drawn template", async () => {
    const layout = await layoutPipeline(withTemplates(), METRICS);
    expect(layout.inheritance.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      ".deploy-base->rollback",
      ".deploy-base->ship",
      ".docker->image",
    ]);
  });

  test("an inheritance edge says it is an extends into a job", async () => {
    const layout = await layoutPipeline(withTemplates(), METRICS);
    expect(layout.inheritance.find((edge) => edge.target === "image")).toMatchObject({
      kind: "extends",
      into: "job",
    });
  });

  function chained(): Pipeline {
    const base = withTemplates();
    return {
      ...base,
      jobs: base.jobs.map((job) =>
        job.id === "rollback" ? { ...job, extends: [], merges: [".deploy-base", ".docker"] } : job,
      ),
      templates: [
        { id: ".deploy-base", range: { start: 0, end: 1 }, file: MAIN, extends: [".docker"] },
        { id: ".docker", range: { start: 2, end: 3 }, file: MAIN, extends: [] },
        {
          id: ".unused",
          range: { start: 4, end: 5 },
          file: MAIN,
          extends: [".deploy-base"],
          merges: [".docker"],
        },
      ],
    };
  }

  test("a template extending another is drawn one column downstream of its parent", async () => {
    const layout = await layoutPipeline(chained(), METRICS);
    const at = new Map(layout.templates.map((node) => [node.id, node]));
    const step = METRICS.nodeWidth + METRICS.columnGap;
    const first = layout.columns[0]?.x ?? 0;
    expect(at.get(".docker")?.x).toBe(first - 3 * step);
    expect(at.get(".deploy-base")?.x).toBe(first - 2 * step);
    expect(at.get(".unused")?.x).toBe(first - step);
  });

  test("templates sharing a column do not overlap", async () => {
    const pipelineWithSiblings: Pipeline = {
      ...chained(),
      templates: [
        { id: ".a", range: { start: 0, end: 1 }, file: MAIN, extends: [] },
        { id: ".b", range: { start: 2, end: 3 }, file: MAIN, extends: [".a"] },
        { id: ".c", range: { start: 4, end: 5 }, file: MAIN, extends: [".a"] },
        { id: ".d", range: { start: 6, end: 7 }, file: MAIN, extends: [] },
      ],
    };
    const layout = await layoutPipeline(pipelineWithSiblings, METRICS);
    for (const left of layout.templates) {
      for (const right of layout.templates) {
        if (left.id >= right.id) {
          continue;
        }
        const apart =
          left.x + left.width <= right.x ||
          right.x + right.width <= left.x ||
          left.y + left.height <= right.y ||
          right.y + right.height <= left.y;
        expect(apart).toBe(true);
      }
    }
    expect(layout.height).toBeGreaterThanOrEqual(
      Math.max(...layout.templates.map((node) => node.y + node.height)),
    );
  });

  test("template-to-template extends and merges are edges of their own kind", async () => {
    const layout = await layoutPipeline(chained(), METRICS);
    expect(
      layout.inheritance
        .map((edge) => `${edge.source} ${edge.kind} ${edge.into} ${edge.target}`)
        .sort(),
    ).toEqual([
      ".deploy-base extends job ship",
      ".deploy-base extends template .unused",
      ".deploy-base merge job rollback",
      ".docker extends job image",
      ".docker extends template .deploy-base",
      ".docker merge job rollback",
      ".docker merge template .unused",
    ]);
    expect(new Set(layout.inheritance.map((edge) => edge.id)).size).toBe(layout.inheritance.length);
  });

  test("an extends cycle between templates still places every template once", async () => {
    const cyclic: Pipeline = {
      ...chained(),
      templates: [
        { id: ".a", range: { start: 0, end: 1 }, file: MAIN, extends: [".b"] },
        { id: ".b", range: { start: 2, end: 3 }, file: MAIN, extends: [".a"] },
        { id: ".self", range: { start: 4, end: 5 }, file: MAIN, extends: [".self"] },
      ],
    };
    const layout = await layoutPipeline(cyclic, METRICS);
    expect(layout.templates.map((node) => node.id).sort()).toEqual([".a", ".b", ".self"]);
    expect(layout.inheritance.some((edge) => edge.source === edge.target)).toBe(false);
  });

  test("without templates there is no template column", async () => {
    const layout = await layoutPipeline(SAMPLE, METRICS);
    expect(layout.templates).toEqual([]);
    expect(layout.inheritance).toEqual([]);
  });
});
