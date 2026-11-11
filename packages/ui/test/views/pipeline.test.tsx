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
    const target = document.getElementById(node.getAttribute("aria-describedby") ?? "");
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

  test("every node is reachable from the keyboard", async () => {
    await renderCanvas(SAMPLE);
    for (const id of ["compile", "unit", "lint", "ship"]) {
      const node = await screen.findByRole("button", { name: new RegExp(id) });
      expect(node.getAttribute("tabindex")).not.toBe("-1");
    }
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
