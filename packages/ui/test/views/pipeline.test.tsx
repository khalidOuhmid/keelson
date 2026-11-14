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

/** The node's own description: the first of its `aria-describedby` ids, before the graph's shared
 *  keyboard instructions. */
function ownDescriptionId(element: HTMLElement): string {
  return element.getAttribute("aria-describedby")?.split(" ")[0] ?? "";
}

function descriptionOf(element: HTMLElement): string {
  return document.getElementById(ownDescriptionId(element))?.textContent ?? "";
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

const MAIN = ".gitlab-ci.yml";

function pipeline(stages: { name: string; implicit?: boolean }[], jobs: JobSpec[]): Pipeline {
  return {
    stages: stages.map((stage) => ({
      name: stage.name,
      implicit: stage.implicit ?? false,
      range: null,
      file: MAIN,
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
  test("a local value has no badge", () => {
    expect(describeOrigin({ kind: "local" })).toBeNull();
  });

  test("an extends names its template, separate from Keelson's voice", () => {
    expect(describeOrigin({ kind: "extends", template: ".base" })).toEqual({
      label: "inherited from",
      source: ".base",
    });
  });

  test("a default is announced as such and cites no source", () => {
    expect(describeOrigin({ kind: "default" })).toEqual({ label: "default", source: null });
  });

  test("an anchor names its anchor", () => {
    expect(describeOrigin({ kind: "anchor", name: "defaults" })).toEqual({
      label: "from anchor",
      source: "&defaults",
    });
  });

  test("a !reference names its path", () => {
    expect(describeOrigin({ kind: "reference", path: [".needs", "common"] })).toEqual({
      label: "from reference",
      source: "[.needs, common]",
    });
  });
});

describe("stage columns", () => {
  test("one column per stage, in stage order", async () => {
    await renderCanvas(SAMPLE);
    const headers = await screen.findAllByTestId("stage-column-name");
    expect(headers.map((element) => element.textContent)).toEqual(["build", "test", "deploy"]);
  });

  test("each column announces its job count", async () => {
    await renderCanvas(SAMPLE);
    const column = await screen.findByRole("group", { name: /stage test/i });
    expect(column.textContent).toContain("2");
  });

  test("an implicit stage is flagged", async () => {
    await renderCanvas(
      pipeline([{ name: "build", implicit: true }], [{ id: "a", stage: "build" }]),
    );
    expect(await screen.findByText(/implicit/i)).toBeDefined();
  });

  test("a declared stage is not flagged as implicit", async () => {
    await renderCanvas(SAMPLE);
    expect(screen.queryByText(/implicit/i)).toBeNull();
  });
});

describe("job nodes", () => {
  test("one button per job, named by its id", async () => {
    await renderCanvas(SAMPLE);
    for (const id of ["compile", "unit", "lint", "ship"]) {
      expect(await screen.findByRole("button", { name: new RegExp(id) })).toBeDefined();
    }
  });

  test("the node shows its stage", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /compile/ });
    expect(node.textContent).toContain("build");
  });

  test("the node describes its dependencies via aria-describedby", async () => {
    await renderCanvas(SAMPLE);
    const description = descriptionOf(await screen.findByRole("button", { name: /ship/ }));
    expect(description).toContain("unit");
    expect(description).toContain("lint");
    expect(description.toLowerCase()).toContain("optional");
  });

  test("no node uses aria-description, which is poorly supported", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /ship/ });
    expect(node.getAttribute("aria-description")).toBeNull();
    expect(node.getAttribute("aria-describedby")).not.toBeNull();
  });

  test("the element describing the node is visually hidden but present in the DOM", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /ship/ });
    const target = document.getElementById(ownDescriptionId(node));
    expect(target).not.toBeNull();
    expect(target?.className).toContain("sr-only");
  });

  test("each node points to its own description element", async () => {
    await renderCanvas(SAMPLE);
    const ship = await screen.findByRole("button", { name: /ship/ });
    const compile = await screen.findByRole("button", { name: /compile/ });
    expect(ship.getAttribute("aria-describedby")).not.toBe(
      compile.getAttribute("aria-describedby"),
    );
  });

  test("a job without dependencies says so", async () => {
    await renderCanvas(SAMPLE);
    const node = await screen.findByRole("button", { name: /compile/ });
    expect(descriptionOf(node).toLowerCase()).toContain("no dependencies");
  });

  test("the selected job is marked", async () => {
    await renderCanvas(SAMPLE, { selectedJobId: "unit" });
    const selected = await screen.findByRole("button", { name: /unit/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    const other = await screen.findByRole("button", { name: /compile/ });
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("origin badges", () => {
  test("a stage inherited from an extends carries its badge", async () => {
    await renderCanvas(
      pipeline(
        [{ name: "build" }],
        [{ id: "a", stage: "build", stageOrigin: { kind: "extends", template: ".base" } }],
      ),
    );
    expect(
      (await screen.findAllByTestId("origin-badge")).map((badge) => badge.textContent),
    ).toContain("inherited from .base");
  });

  test("a stage from the default carries the default badge", async () => {
    await renderCanvas(
      pipeline([{ name: "test" }], [{ id: "a", stage: "test", stageOrigin: { kind: "default" } }]),
    );
    expect(await screen.findByText("default")).toBeDefined();
  });

  test("a local stage carries no badge", async () => {
    await renderCanvas(pipeline([{ name: "build" }], [{ id: "a", stage: "build" }]));
    expect(screen.queryByTestId("origin-badge")).toBeNull();
  });

  test("the badge is announced as origin information", async () => {
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

describe("selection", () => {
  test("clicking a node selects its job", async () => {
    const selected: (string | null)[] = [];
    await renderCanvas(SAMPLE, { onSelect: (id) => selected.push(id) });
    await userEvent.click(await screen.findByRole("button", { name: /unit/ }));
    expect(selected).toEqual(["unit"]);
  });

  test("Enter on a focused node selects its job", async () => {
    const selected: (string | null)[] = [];
    await renderCanvas(SAMPLE, { onSelect: (id) => selected.push(id) });
    const node = await screen.findByRole("button", { name: /lint/ });
    node.focus();
    await userEvent.keyboard("{Enter}");
    expect(selected).toEqual(["lint"]);
  });

  test("every node is reachable from the keyboard, from the graph's one tab stop", async () => {
    await renderCanvas(SAMPLE);
    await screen.findByRole("button", { name: /ship/ });
    await userEvent.tab();
    const reached = new Set<string>();
    for (const key of ["{ArrowDown}", "{ArrowRight}", "{ArrowDown}", "{ArrowUp}", "{ArrowRight}"]) {
      reached.add((document.activeElement as HTMLElement).dataset.jobId ?? "");
      await userEvent.keyboard(key);
    }
    reached.add((document.activeElement as HTMLElement).dataset.jobId ?? "");
    expect(reached).toEqual(new Set(["compile", "unit", "lint", "ship"]));
  });
});

describe("empty pipeline", () => {
  test("a pipeline without jobs shows an explicit empty state", async () => {
    await renderCanvas(pipeline([{ name: "build" }], []));
    expect(await screen.findByText(/no jobs/i)).toBeDefined();
  });

  test("a pipeline with no stages or jobs still renders without error", async () => {
    await renderCanvas(pipeline([], []));
    expect(await screen.findByRole("region", { name: /pipeline/i })).toBeDefined();
  });
});

describe("the graph's keyboard model, on the render", () => {
  const node = (id: string) => document.querySelector<HTMLElement>(`[data-job-id="${id}"]`);
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset.jobId;

  async function drawn(value: Pipeline, selectedJobId: string | null = null) {
    await renderCanvas(value, { selectedJobId });
    await screen.findByRole("button", { name: /ship/ });
  }

  test("the graph is one tab stop: the first job, or the selected one", async () => {
    await drawn(SAMPLE);
    const stops = [...document.querySelectorAll<HTMLElement>("[data-job-id]")].filter(
      (element) => element.tabIndex === 0,
    );
    expect(stops.map((element) => element.dataset.jobId)).toEqual(["compile"]);

    cleanup();
    await drawn(SAMPLE, "lint");
    expect(node("lint")?.tabIndex).toBe(0);
    expect(node("compile")?.tabIndex).toBe(-1);
  });

  test("Tab enters the graph on its one stop and leaves it at the next press", async () => {
    await drawn(SAMPLE);
    await userEvent.tab();
    expect(focused()).toBe("compile");
    await userEvent.tab();
    expect(focused()).toBeUndefined();
  });

  test("arrows move within a stage and across stages, Home and End reach the ends", async () => {
    await drawn(SAMPLE);
    node("compile")?.focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(["unit", "lint"]).toContain(focused() ?? "");
    const first = focused();
    await userEvent.keyboard("{ArrowDown}");
    const second = focused();
    expect(new Set([first, second])).toEqual(new Set(["unit", "lint"]));
    await userEvent.keyboard("{ArrowDown}");
    expect(focused()).toBe(second);
    await userEvent.keyboard("{ArrowUp}");
    expect(focused()).toBe(first);

    await userEvent.keyboard("{ArrowRight}");
    expect(focused()).toBe("ship");
    await userEvent.keyboard("{ArrowRight}");
    expect(focused()).toBe("ship");
    await userEvent.keyboard("{Home}");
    expect(focused()).toBe("compile");
    await userEvent.keyboard("{ArrowLeft}");
    expect(focused()).toBe("compile");
    await userEvent.keyboard("{End}");
    expect(focused()).toBe("ship");
  });

  test("Shift with an arrow follows a dependency edge", async () => {
    await drawn(SAMPLE);
    node("ship")?.focus();

    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(focused()).toBe("unit");
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(focused()).toBe("compile");
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(focused()).toBe("compile");
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(focused()).toBe("unit");
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(focused()).toBe("ship");
  });

  test("the tab stop follows the last focused job", async () => {
    await drawn(SAMPLE);
    node("compile")?.focus();
    await userEvent.keyboard("{End}");
    expect(node("ship")?.tabIndex).toBe(0);
    expect(node("compile")?.tabIndex).toBe(-1);
  });

  test("every job node points to the keyboard instructions", async () => {
    await drawn(SAMPLE);
    const ids = node("unit")?.getAttribute("aria-describedby")?.split(" ") ?? [];
    const text = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(text).toContain("Arrow keys move between jobs");
    expect(text).toContain("Shift");
  });
});

describe("templates on the render", () => {
  const TEMPLATED: Pipeline = {
    ...pipeline(
      [{ name: "build" }, { name: "deploy" }],
      [
        { id: "image", stage: "build", extends: [".docker"] },
        { id: "ship", stage: "deploy", extends: [".deploy-base"] },
      ],
    ),
    templates: [
      { id: ".docker", range: { start: 0, end: 5 }, file: MAIN, extends: [] },
      { id: ".deploy-base", range: { start: 6, end: 9 }, file: MAIN, extends: [] },
    ],
  };

  test("each template is drawn, apart from the jobs and the stages", async () => {
    await renderCanvas(TEMPLATED);
    const column = await screen.findByRole("group", { name: "Templates" });
    expect(column.textContent).toContain("2 templates");
    const drawn = [...document.querySelectorAll<HTMLElement>("[data-template-id]")];
    expect(drawn.map((element) => element.dataset.templateId)).toEqual([".docker", ".deploy-base"]);
    for (const element of drawn) {
      expect(element.closest("[data-job-id]")).toBeNull();
      expect(element.textContent).toContain("template");
    }
  });

  test("the stage headers still count only the jobs drawn in their column", async () => {
    await renderCanvas(TEMPLATED);
    const headers = await screen.findAllByTestId("stage-column-name");
    expect(headers.map((element) => element.textContent)).toEqual(["build", "deploy"]);
    expect((await screen.findByRole("group", { name: "Stage deploy" })).textContent).toContain(
      "1 job",
    );
    expect(document.querySelectorAll("[data-job-id]")).toHaveLength(2);
  });

  const CHAINED: Pipeline = {
    ...pipeline(
      [{ name: "build" }, { name: "deploy" }],
      [
        { id: "image", stage: "build", extends: [".docker"] },
        { id: "ship", stage: "deploy", extends: [".deploy-base"] },
      ],
    ),
    templates: [
      { id: ".deploy-base", range: { start: 0, end: 5 }, file: MAIN, extends: [".docker"] },
      { id: ".docker", range: { start: 6, end: 9 }, file: MAIN, extends: [] },
    ],
  };

  function nodeLeft(id: string): number {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
    const match = /translate\((-?[\d.]+)px/.exec(node?.style.transform ?? "");
    if (match?.[1] === undefined) {
      throw new Error(`node ${id} has no position`);
    }
    return Number(match[1]);
  }

  test("a template extending another is drawn downstream of it, with a handle the link comes into", async () => {
    await renderCanvas(CHAINED);
    await screen.findByRole("group", { name: "Templates" });
    expect(nodeLeft("template:.docker")).toBeLessThan(nodeLeft("template:.deploy-base"));
    expect(nodeLeft("template:.deploy-base")).toBeLessThan(nodeLeft("column:build"));
    const handles = (id: string) =>
      document.querySelectorAll(`.react-flow__node[data-id="${id}"] .react-flow__handle.target`)
        .length;
    expect(handles("template:.deploy-base")).toBe(1);
    expect(handles("template:.docker")).toBe(0);
  });

  test("the template column frames every template level", async () => {
    await renderCanvas(CHAINED);
    await screen.findByRole("group", { name: "Templates" });
    const column = document.querySelector<HTMLElement>(
      '.react-flow__node[data-id="column:templates"]',
    );
    expect(nodeLeft("column:templates")).toBe(nodeLeft("template:.docker"));
    expect(Number.parseFloat(column?.style.width ?? "0")).toBeGreaterThan(
      nodeLeft("template:.deploy-base") - nodeLeft("template:.docker"),
    );
  });
});
