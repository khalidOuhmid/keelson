import { afterEach, describe, expect, test } from "bun:test";
import type { JobCoverage } from "@keelson/catalog";
import type { Job, OpaqueBlock, Origin } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import { JobDetailPanel } from "../../src/panels/JobDetailPanel.tsx";
import { sliceOpaque } from "../../src/panels/opaque.ts";

afterEach(cleanup);

const TEXT = [
  "compile:",
  "  stage: build",
  "  script:",
  "    - make all",
  "    - make check",
  "  artifacts:",
  "    paths:",
  "      - build/",
  "",
].join("\n");

const MAIN = ".gitlab-ci.yml";

function at(needle: string, length: number): OpaqueBlock {
  const start = TEXT.indexOf(needle);
  return { key: needle.replace(":", ""), range: { start, end: start + length }, file: MAIN };
}

const SCRIPT_BLOCK = at("script:", "script:\n    - make all\n    - make check\n".length);
const ARTIFACTS_BLOCK = at("artifacts:", "artifacts:\n    paths:\n      - build/\n".length);

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "compile",
    stage: { value: "build", origin: { kind: "local" } },
    needs: null,
    environment: null,
    extends: [],
    opaque: [SCRIPT_BLOCK],
    signals: { image: null, script: [] },
    range: { start: 0, end: TEXT.length },
    file: MAIN,
    ...overrides,
  };
}

function renderPanel(value: Job, text = TEXT, texts: Record<string, string> = {}) {
  return render(
    <JobDetailPanel
      job={value}
      textOf={(file) => (file === MAIN ? text : (texts[file] ?? ""))}
      main={MAIN}
      onClose={() => undefined}
    />,
  );
}

describe("sliceOpaque", () => {
  test("slices the block out of the source text", () => {
    expect(sliceOpaque(TEXT, SCRIPT_BLOCK)).toBe("script:\n    - make all\n    - make check");
  });

  test("strips the trailing newline for display", () => {
    expect(sliceOpaque(TEXT, ARTIFACTS_BLOCK)?.endsWith("\n")).toBe(false);
  });

  test("an out-of-bounds range yields an empty string rather than throwing", () => {
    expect(
      sliceOpaque(TEXT, { key: "x", range: { start: 9000, end: 9100 }, file: MAIN }),
    ).toBeNull();
  });

  test("an inverted range yields an empty string", () => {
    expect(sliceOpaque(TEXT, { key: "x", range: { start: 50, end: 10 }, file: MAIN })).toBeNull();
  });
});

describe("job identity", () => {
  test("the panel names the job", () => {
    renderPanel(job());
    expect(screen.getByRole("heading", { name: "compile" })).toBeDefined();
  });

  test("the panel is a named region", () => {
    renderPanel(job());
    expect(screen.getByRole("region", { name: /job detail/i })).toBeDefined();
  });
});

describe("stage", () => {
  test("shows the current stage", () => {
    renderPanel(job());
    expect(screen.getByTestId("job-stage").textContent).toContain("build");
  });

  test("an inherited stage carries its origin badge", () => {
    renderPanel(job({ stage: { value: "build", origin: { kind: "extends", template: ".base" } } }));
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "inherited from .base",
    );
  });

  test("a local stage carries no badge", () => {
    renderPanel(job());
    expect(screen.queryByTestId("origin-badge")).toBeNull();
  });
});

describe("needs", () => {
  test("lists the job's needs", () => {
    renderPanel(
      job({
        needs: {
          value: [
            { job: "prepare", optional: false, artifacts: true },
            { job: "lint", optional: true, artifacts: false },
          ],
          origin: { kind: "local" },
        },
      }),
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.includes("prepare"))).toContain(true);
    expect(items.map((item) => item.textContent?.includes("lint"))).toContain(true);
  });

  test("marks an optional need", () => {
    renderPanel(
      job({
        needs: {
          value: [{ job: "lint", optional: true, artifacts: true }],
          origin: { kind: "local" },
        },
      }),
    );
    expect(screen.getByText(/optional/i)).toBeDefined();
  });

  test("marks a need without artifacts", () => {
    renderPanel(
      job({
        needs: {
          value: [{ job: "lint", optional: false, artifacts: false }],
          origin: { kind: "local" },
        },
      }),
    );
    expect(screen.getByText(/no artifacts/i)).toBeDefined();
  });

  test("says explicitly when the job has no needs", () => {
    renderPanel(job());
    expect(screen.getByText(/no dependencies/i)).toBeDefined();
  });

  test("inherited needs carry their origin badge", () => {
    renderPanel(
      job({
        needs: {
          value: [{ job: "prepare", optional: false, artifacts: true }],
          origin: { kind: "extends", template: ".base" },
        },
      }),
    );
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "inherited from .base",
    );
  });
});

describe("environment", () => {
  test("shows the environment name", () => {
    renderPanel(job({ environment: { value: { name: "production" }, origin: { kind: "local" } } }));
    expect(screen.getByTestId("job-environment").textContent).toContain("production");
  });

  test("shows the URL and the action when they exist", () => {
    renderPanel(
      job({
        environment: {
          value: { name: "staging", url: "https://staging.example.org", action: "start" },
          origin: { kind: "local" },
        },
      }),
    );
    const section = screen.getByTestId("job-environment");
    expect(section.textContent).toContain("https://staging.example.org");
    expect(section.textContent).toContain("start");
  });

  test("says explicitly that there is no environment", () => {
    renderPanel(job());
    expect(screen.getByTestId("job-environment").textContent).toMatch(/none/i);
  });
});

describe("extends", () => {
  test("lists the extended templates in declared order", () => {
    renderPanel(job({ extends: [".premier", ".second"] }));
    const section = screen.getByTestId("job-extends");
    expect(section.textContent).toContain(".premier");
    expect(section.textContent).toContain(".second");
  });

  test("hides the section when the job extends nothing", () => {
    renderPanel(job());
    expect(screen.queryByTestId("job-extends")).toBeNull();
  });
});

describe("opaque blocks", () => {
  test("one block per unmodelled key, named by its key", () => {
    renderPanel(job({ opaque: [SCRIPT_BLOCK, ARTIFACTS_BLOCK] }));
    expect(screen.getByRole("group", { name: /script/ })).toBeDefined();
    expect(screen.getByRole("group", { name: /artifacts/ })).toBeDefined();
  });

  test("the block is announced as read-only", () => {
    renderPanel(job());
    expect(screen.getByRole("group", { name: /script/ }).textContent).toMatch(/read-only/i);
  });

  test("the block content is the source text sliced by its range", async () => {
    renderPanel(job());
    const editor = await screen.findByTestId("opaque-editor-script");
    expect(editor.textContent).toContain("make all");
    expect(editor.textContent).toContain("make check");
  });

  test("no opaque blocks shows an empty state", () => {
    renderPanel(job({ opaque: [] }));
    expect(screen.getByText(/no opaque blocks/i)).toBeDefined();
  });
});

describe("combined origins", () => {
  test("each inherited value is flagged independently", () => {
    const inherited: Origin = { kind: "extends", template: ".base" };
    renderPanel(
      job({
        stage: { value: "test", origin: inherited },
        needs: {
          value: [{ job: "prepare", optional: false, artifacts: true }],
          origin: { kind: "anchor", name: "defaults" },
        },
      }),
    );
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "inherited from .base",
    );
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "from anchor &defaults",
    );
  });
});

describe("opaque block whose range cannot be read", () => {
  /** `sliceOpaque` returned `""` on an out-of-bounds or inverted range, as an empty block does
   *  too: the only surface whose promise is "this is verbatim" could not say that it did not
   *  know. Principle 3 of PRODUCT.md requires showing uncertainty. */
  const BROKEN = { key: "script", range: { start: 9000, end: 9100 }, file: MAIN };

  test("sliceOpaque tells the unreadable from the empty", () => {
    expect(sliceOpaque("", { key: "script", range: { start: 0, end: 0 }, file: MAIN })).toBeNull();
    expect(sliceOpaque(TEXT, BROKEN)).toBeNull();
  });

  test("the panel says so explicitly instead of showing an empty frame", () => {
    renderPanel(job({ opaque: [BROKEN] }));

    const block = screen.getByRole("group", { name: "Opaque block script" });
    expect(block.textContent).toContain("Content unavailable");
    expect(block.textContent).toContain("still on disk");
  });
});

describe("a job's layers, in the Coverage view", () => {
  function renderWith(coverage: JobCoverage) {
    render(
      <JobDetailPanel
        job={job()}
        textOf={() => TEXT}
        main={MAIN}
        coverage={coverage}
        onClose={() => undefined}
      />,
    );
    return screen.getByTestId("job-layers-source").textContent;
  }

  test("names the recognised tool", () => {
    expect(
      renderWith({ job: "compile", layers: ["sast"], tools: ["semgrep"], overridden: false }),
    ).toBe("Detected from semgrep.");
  });

  test("an override is distinguished from a detection", () => {
    expect(
      renderWith({ job: "compile", layers: ["sast"], tools: ["semgrep"], overridden: true }),
    ).toBe("Set by .devsecops/layout.json.");
  });

  test("without a tool, says so", () => {
    expect(renderWith({ job: "compile", layers: [], tools: [], overridden: false })).toBe(
      "Keelson recognised no tool in this job.",
    );
  });

  test("outside the Coverage view, nothing", () => {
    renderPanel(job());
    expect(screen.queryByTestId("job-layers")).toBeNull();
  });
});
