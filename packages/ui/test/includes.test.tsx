import { afterEach, describe, expect, test } from "bun:test";
import type { Job, Pipeline, Stage, UnresolvedInclude } from "@keelson/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { StageControls } from "../src/editing/StageControls.tsx";
import { JobDetailPanel } from "../src/panels/JobDetailPanel.tsx";
import type { Draft } from "../src/state/store.ts";
import { PartialPipelineBar } from "../src/states/PartialPipelineBar.tsx";
import { type JobNodeData, toFlowGraph } from "../src/views/pipeline/graph.ts";
import { JobNode, type JobNodeProps } from "../src/views/pipeline/JobNode.tsx";
import type { Layout } from "../src/views/pipeline/layout.ts";
import { ORIGIN_HINT, READ_ONLY_ORIGIN_HINT } from "../src/views/pipeline/origin.ts";

const MAIN = ".gitlab-ci.yml";
const INCLUDED = "ci/jobs.yml";

afterEach(cleanup);

function stage(name: string, file = MAIN): Stage {
  return { name, implicit: false, range: null, file };
}

function job(id: string, file = MAIN, overrides: Partial<Job> = {}): Job {
  return {
    id,
    stage: {
      value: "build",
      origin: file === MAIN ? { kind: "local" } : { kind: "include", file },
    },
    needs: null,
    environment: null,
    extends: [],
    opaque: [],
    signals: { image: null, script: [] },
    range: { start: 0, end: 10 },
    file,
    ...overrides,
  };
}

function pipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    stages: [stage("build"), stage("test")],
    jobs: [job("local-job"), job("sast", INCLUDED)],
    templates: [],
    opaque: [],
    main: MAIN,
    files: [INCLUDED, MAIN],
    unresolved: [],
    ...overrides,
  };
}

describe("an included job in the Pipeline view", () => {
  function nodeData(id: string) {
    const layout: Layout = {
      nodes: pipeline().jobs.map((entry, index) => ({
        id: entry.id,
        x: 0,
        y: index * 80,
        width: 200,
        height: 64,
      })),
      columns: [
        { name: "build", x: 0, width: 232, jobIds: ["local-job", "sast"], implicit: false },
        { name: "test", x: 300, width: 232, jobIds: [], implicit: false },
      ],
      height: 160,
      edges: [],
    };
    const graph = toFlowGraph(layout, pipeline(), null);
    const found = graph.nodes.find((node) => node.id === id);
    if (found === undefined) {
      throw new Error(`node ${id} missing from the graph`);
    }
    return found.data as JobNodeData;
  }

  /** `JobNode` reads xyflow's context through its `Handle`s: without the provider, rendering throws. */
  function renderNode(id: string) {
    return render(
      <ReactFlowProvider>
        {/* `JobNode` only uses `data`; the rest of `NodeProps` is supplied by xyflow in
            production and has no effect on what this test measures. */}
        <JobNode {...({ id, data: nodeData(id) } as JobNodeProps)} />
      </ReactFlowProvider>,
    );
  }

  test("the graph marks the job from an included file", () => {
    expect(nodeData("sast").included).toBe(true);
    expect(nodeData("sast").file).toBe(INCLUDED);
    expect(nodeData("local-job").included).toBe(false);
  });

  /** The promise is that the mark **is not colour alone**: the word `read-only` is in the rendered
   *  DOM, and it is there too when the surface tone changes. A test that only checked the
   *  background class would let a tinted but silent node through.
   *
   *  No `title`: as measured by the audit pass, a `title`'s text appears **nowhere** in the
   *  accessibility tree when an `aria-describedby` is present — neither as name nor as
   *  description. Two wordings of the same fact coexisted, only one of which was ever read, and
   *  that one was only reachable with the mouse. */
  test("the node renders the word read-only and tells a screen reader", () => {
    renderNode("sast");

    expect(screen.getByText("read-only")).toBeDefined();
    const button = screen.getByRole("button", { name: /sast/ });
    expect(button.getAttribute("data-included")).toBe("true");
    const described = button.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toContain(
      `From included file ${INCLUDED}. Read-only.`,
    );
  });

  /** Measured by the L2b `critique` pass: the badge took 178 px of a 205 px row and squeezed the
   *  stage down to a truncated 23 px. It is therefore absent from an included node, and stays on a
   *  main-file node, where it is not redundant with `read-only`. */
  test("the origin badge is not on an included node", () => {
    renderNode("sast");
    expect(screen.queryByTestId("origin-badge")).toBeNull();
  });

  test("the origin badge stays on a main-file node", () => {
    render(
      <ReactFlowProvider>
        <JobNode
          {...({
            id: "local-job",
            data: {
              ...nodeData("local-job"),
              stageOrigin: { kind: "extends", template: ".base" },
            },
          } as JobNodeProps)}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("origin-badge")).toBeDefined();
  });

  test("a main-file job carries none of these marks", () => {
    renderNode("local-job");
    expect(screen.queryByText("read-only")).toBeNull();
    const button = screen.getByRole("button", { name: /local-job/ });
    expect(button.getAttribute("data-included")).toBe("false");
  });
});

describe("the detail panel of an included job", () => {
  function renderPanel(target: Job, texts: Record<string, string> = {}) {
    return render(
      <JobDetailPanel
        job={target}
        textOf={(file) => texts[file] ?? ""}
        main={MAIN}
        onClose={() => undefined}
      />,
    );
  }

  test("names the source file and spells out the reason", () => {
    renderPanel(job("sast", INCLUDED));

    expect(screen.getByTestId("job-source-file").textContent).toContain(INCLUDED);
    // The word is searched for **in the heading**: every opaque block header carries the same
    // word, so a search over the whole document would not measure the job's mark.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("read-only");
    const described = screen
      .getByRole("region", { name: "Job detail" })
      .getAttribute("aria-describedby");
    expect(document.getElementById(described ?? "")?.textContent).toBe(
      "This job is defined in an included file. Keelson never writes to included files, so it cannot be edited here. Open that file in your own editor to change it.",
    );
  });

  /** The defect this test prevents: `sliceOpaque` sliced the **main** file's text. The two texts
   *  below have the same length and different bytes at the same offset — otherwise the test would
   *  pass with the wrong file, and the screen would show a fragment taken from elsewhere under the
   *  sole promise "this is verbatim". */
  test("an opaque block is sliced from its own file's text", () => {
    const includedText = "script:\n  - make inclu\n";
    const mainText = "script:\n  - make LOCAL\n";
    expect(includedText.length).toBe(mainText.length);

    renderPanel(
      job("sast", INCLUDED, {
        opaque: [{ key: "script", range: { start: 0, end: includedText.length }, file: INCLUDED }],
      }),
      { [MAIN]: mainText, [INCLUDED]: includedText },
    );

    const block = screen.getByRole("group", { name: "Opaque block script" });
    expect(block.textContent).toContain("make inclu");
    expect(block.textContent).not.toContain("LOCAL");
  });

  test("the source file is only named if it is not the main file", () => {
    renderPanel(job("local-job"));
    expect(screen.queryByTestId("job-source-file")).toBeNull();
  });

  test("a main-file job has no lock note", () => {
    renderPanel(job("local-job"));
    expect(
      screen.getByRole("region", { name: "Job detail" }).getAttribute("aria-describedby"),
    ).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).not.toContain("read-only");
  });
});

describe("stage controls when the list comes from an include", () => {
  function renderStages(stagesFile: string) {
    const drafts: Draft[] = [];
    render(
      <StageControls
        pipeline={pipeline({ stages: [stage("build", stagesFile), stage("test", stagesFile)] })}
        onSubmit={(draft) => drafts.push(draft)}
      />,
    );
    return drafts;
  }

  test("everything is disabled and the reason names the file", () => {
    renderStages(INCLUDED);

    expect(
      [...document.querySelectorAll("input, select, button")].filter(
        (control) => !control.hasAttribute("disabled"),
      ),
    ).toEqual([]);
    expect(
      screen.getByText(
        `The stage list is defined in ${INCLUDED}, an included file. Keelson never writes to included files, so stages cannot be added or reordered here.`,
      ),
    ).toBeDefined();
  });

  test("a list from the main file stays editable", () => {
    renderStages(MAIN);
    expect(
      [...document.querySelectorAll("button")].some((button) => !button.hasAttribute("disabled")),
    ).toBe(true);
  });
});

describe("the partial pipeline indicator", () => {
  const remote: UnresolvedInclude = {
    form: "remote",
    detail: "https://example.org/ci.yml",
    from: MAIN,
    range: { start: 12, end: 44 },
  };

  function renderBar(unresolved: UnresolvedInclude[]) {
    return render(<PartialPipelineBar pipeline={pipeline({ unresolved })} />);
  }

  test("its disclosure chevron takes the rotation class passed to the icon", () => {
    renderBar([remote]);
    const chevron = document.querySelector("summary svg");
    expect(chevron?.getAttribute("class")).toContain("group-open:rotate-90");
  });

  test("absent when every include is resolved", () => {
    const { container } = renderBar([]);
    expect(container.textContent).toBe("");
  });

  test("present and named as soon as an include is not", () => {
    renderBar([remote]);
    expect(screen.getByRole("group", { name: "Partial pipeline" })).toBeDefined();
    expect(
      screen.getByText("Some includes are not resolved, so jobs may be missing from this view."),
    ).toBeDefined();
    expect(screen.getByText("1 unresolved include")).toBeDefined();
  });

  test("the count agrees in the plural", () => {
    renderBar([remote, { ...remote, form: "template", detail: "Jobs/SAST.gitlab-ci.yml" }]);
    expect(screen.getByText("2 unresolved includes")).toBeDefined();
  });

  /** "The UI must say it rather than hide it" only holds if it says **what** is missing: the
   *  form and the written value, not just that something is missing. */
  test("each entry names its form, its value and the file that declares it", () => {
    renderBar([remote]);
    expect(screen.getByText("remote")).toBeDefined();
    expect(screen.getByText("https://example.org/ci.yml")).toBeDefined();
    expect(screen.getByText("declared in")).toBeDefined();
    expect(screen.getByText(MAIN)).toBeDefined();
  });

  /** The three differences from `NoticeBar`, which announces the consequence of an action: a gap
   *  is not an event, hence no live region, and a fact cannot be dismissed. */
  test("it is neither an alert nor a status, and nothing can be dismissed", () => {
    renderBar([remote]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  /** No entry is clickable. The first version made each one a button calling `selectByRange`,
   *  and it was a dead click: an include's range falls within the opaque block of the top-level
   *  `include` key, which `selectByRange` can never match to a job.
   *  The banner's only control is the `summary`. */
  test("no entry is a control", () => {
    renderBar([remote]);
    expect(
      screen.queryByRole("button", { name: (name) => name.includes("example.org/ci.yml") }),
    ).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  /** This test measures the summary's **focusability**, and nothing more: `happy-dom` does not
   *  implement the native `<details>` toggle on Enter, so asserting it here would measure the
   *  simulated DOM, not the product. Keyboard expansion is checked in a real browser, in
   *  `e2e/includes.e2e.ts`. The first version of this test called `.focus()` and stopped there
   *  without saying so. */
  test("the summary is keyboard-focusable", () => {
    renderBar([remote]);

    const summary = document.querySelector("summary");
    expect(summary).not.toBeNull();
    summary?.focus();
    expect(document.activeElement).toBe(summary);
  });
});

describe("the origin badge hint text, in the detail panel", () => {
  /** The text depends on the job **and** the origin. The first fix only looked at the origin, and
   *  said "cannot be overridden here" on a job overridden in the main file, which stays editable:
   *  the error had just switched sides. These tests go through the panel because it is the one
   *  that knows whether the job is editable, and a test on the badge alone would miss the gap. */
  function hintOn(target: Job): string | null {
    render(<JobDetailPanel job={target} textOf={() => ""} main={MAIN} onClose={() => undefined} />);
    return screen.getByTestId("origin-badge").getAttribute("title");
  }

  const includeOrigin = { kind: "include", file: INCLUDED } as const;
  const extendsOrigin = { kind: "extends", template: ".base" } as const;

  test("main-file job, value from an include: the override is written here", () => {
    const hint = hintOn(job("compile", MAIN, { stage: { value: "build", origin: includeOrigin } }));
    expect(hint).toBe(
      "This value comes from an included file. Changing it writes an explicit override in this job and never touches that file.",
    );
  });

  test("main-file job, value inherited from a template: the origin text", () => {
    const hint = hintOn(job("compile", MAIN, { stage: { value: "build", origin: extendsOrigin } }));
    expect(hint).toBe(ORIGIN_HINT);
  });

  test("included job, value from an include: nothing can be overridden", () => {
    const hint = hintOn(job("sast", INCLUDED));
    expect(hint).toBe(
      "This job is defined in an included file. Keelson never writes to included files, so this value cannot be overridden here.",
    );
  });

  /** The three fields, one by one: the text goes through three separate `Field` calls, and a test
   *  on the stage alone left the other two unguarded. */
  test("Stage, Needs and Environment all carry the same refusal on an included job", () => {
    render(
      <JobDetailPanel
        job={job("sast", INCLUDED, {
          needs: { value: [], origin: includeOrigin },
          environment: { value: { name: "prod" }, origin: includeOrigin },
        })}
        textOf={() => ""}
        main={MAIN}
        onClose={() => undefined}
      />,
    );
    for (const field of ["job-stage", "job-needs", "job-environment"]) {
      const badge = within(screen.getByTestId(field)).getByTestId("origin-badge");
      expect({ field, hint: badge.getAttribute("title") }).toEqual({
        field,
        hint: READ_ONLY_ORIGIN_HINT,
      });
    }
  });

  /** The case that looking at the origin alone could not see: an included job whose value comes
   *  from an `extends` carried `ORIGIN_HINT`, which promises an impossible override. */
  test("included job, value inherited from a template: nothing can be overridden either", () => {
    const hint = hintOn(
      job("sast", INCLUDED, { stage: { value: "build", origin: extendsOrigin } }),
    );
    expect(hint).toBe(READ_ONLY_ORIGIN_HINT);
  });
});
