import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Coverage, Tool } from "@keelson/catalog";
import type { Job, Pipeline } from "@keelson/core";
import { findLayer, GUIDELINE_COMMIT, LAYERS, type LayerId } from "@keelson/taxonomy";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { DiagnosticsPanel } from "../src/panels/DiagnosticsPanel.tsx";
import { CatalogView } from "../src/views/catalog/CatalogView.tsx";
import { filterTools } from "../src/views/catalog/filter.ts";
import { CoveragePanel, LOWER_BOUND_NOTE } from "../src/views/coverage/CoveragePanel.tsx";
import { type JobNodeData, toFlowGraph } from "../src/views/pipeline/graph.ts";
import { JobNode, type JobNodeProps } from "../src/views/pipeline/JobNode.tsx";

afterEach(cleanup);

function coverage(covered: Partial<Record<LayerId, string[]>>, partial = false): Coverage {
  return {
    jobs: [],
    partial,
    layers: LAYERS.map(({ id }) => ({
      layer: id,
      covered: covered[id] !== undefined,
      jobs: covered[id] ?? [],
      services: [],
      ci: [],
    })),
  };
}

function tool(id: string, overrides: Partial<Tool> = {}): Tool {
  return {
    id,
    name: id.toUpperCase(),
    kind: "job",
    layers: ["sast"],
    license: "MIT",
    homepage: "https://exemple.org/",
    verifiedAt: "https://exemple.org/verif",
    logo: null,
    detect: { images: [], scripts: [], actions: [] },
    snippets: { gitlab: "a:\n  script: x\n", github: null },
    lastVerified: "2026-11-04",
    integration: null,
    ...overrides,
  };
}

describe("coverage panel", () => {
  function renderPanel(value: Coverage, selected: LayerId | null = null) {
    const onSelect = mock((_layer: LayerId) => undefined);
    const onShowTools = mock((_layer: LayerId) => undefined);
    render(
      <CoveragePanel
        coverage={value}
        selected={selected}
        onSelect={onSelect}
        onShowTools={onShowTools}
      />,
    );
    return { onSelect, onShowTools };
  }

  test("counts the covered layers out of twenty-one", () => {
    renderPanel(coverage({ sast: ["a"], sca: ["b"] }));
    expect(screen.getByTestId("coverage-count").textContent).toBe(
      "2 of 13 OWASP layers covered, 0 of 8 platform categories seen",
    );
  });

  test("a layer covered by a service names it", () => {
    const covered = coverage({});
    renderPanel({
      ...covered,
      layers: covered.layers.map((entry) =>
        entry.layer === "scm" ? { ...entry, covered: true, services: ["git"] } : entry,
      ),
    });
    const group = screen.getByRole("group", { name: "Covered layers" });
    expect(group.textContent).toContain("service git");
  });

  test("source control proven by the CI names it", () => {
    const covered = coverage({});
    renderPanel({
      ...covered,
      layers: covered.layers.map((entry) =>
        entry.layer === "scm" ? { ...entry, covered: true, ci: ["gitlab-ci"] } : entry,
      ),
    });
    const group = screen.getByRole("group", { name: "Covered layers" });
    expect(within(group).getByText("Source control")).toBeDefined();
    expect(group.textContent).toContain("ci gitlab-ci");
  });

  test("several files: the panel says which", () => {
    render(
      <CoveragePanel
        coverage={coverage({})}
        selected={null}
        onSelect={() => undefined}
        onShowTools={() => undefined}
        scope={{ file: "ci.yml", count: 3 }}
      />,
    );
    expect(screen.getByTestId("coverage-scope").textContent).toBe(
      "In ci.yml, 1 of 3 pipeline files.",
    );
  });

  test("an uncovered layer gives its summary, and its path to the tools", async () => {
    const { onShowTools } = renderPanel(coverage({ sast: ["a"] }));
    const uncovered = screen.getByRole("group", { name: "Uncovered OWASP layers" });

    expect(within(uncovered).getByText("Dynamic testing")).toBeDefined();
    expect(
      within(uncovered).getByText("Attacks a running application from the outside."),
    ).toBeDefined();
    expect(within(uncovered).queryByText("Static analysis")).toBeNull();

    const row = within(uncovered).getByText("Dynamic testing").closest("li");
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "See tools" }));
    expect(onShowTools).toHaveBeenCalledWith("dast");
  });

  test("an OWASP layer cites the Guideline, a platform category does not", () => {
    renderPanel(coverage({}));
    const uncovered = screen.getByRole("group", { name: "Uncovered OWASP layers" });
    const rowOf = (name: string) => within(uncovered).getByText(name).closest("li") as HTMLElement;

    const link = within(rowOf("Dynamic testing")).getByRole("link", { name: "OWASP guideline" });
    expect(link.getAttribute("href")).toBe(
      `https://github.com/OWASP/DevSecOpsGuideline/blob/${GUIDELINE_COMMIT}/${findLayer("dast").guideline}`,
    );
    const platform = screen.getByRole("group", { name: "Platform categories not seen" });
    const row = within(platform).getByText("Source control").closest("li") as HTMLElement;
    expect(within(row).queryByRole("link")).toBeNull();
  });

  test("choosing a covered layer highlights it, and the button says so", async () => {
    const { onSelect } = renderPanel(coverage({ sast: ["a", "b"] }), "sast");
    const button = screen.getByRole("button", { name: /Static analysis/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("a, b");
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("sast");
  });

  /** A platform category lives around the pipeline: on a GitLab repository, "Source control" is
   *  not a security gap, and the single count mixed the two frameworks. */
  test("an unseen platform category is not an uncovered OWASP layer", () => {
    renderPanel(coverage({}));
    const owasp = screen.getByRole("group", { name: "Uncovered OWASP layers" });
    const platform = screen.getByRole("group", { name: "Platform categories not seen" });
    expect(within(owasp).queryByText("Source control")).toBeNull();
    expect(within(platform).getByText("Source control")).toBeDefined();
  });

  test("a partial pipeline makes coverage a lower bound, on screen", () => {
    renderPanel(coverage({}, true));
    expect(screen.getByTestId("coverage-lower-bound").textContent).toBe(LOWER_BOUND_NOTE);
  });

  test("a complete pipeline does not say so", () => {
    renderPanel(coverage({}));
    expect(screen.queryByTestId("coverage-lower-bound")).toBeNull();
  });
});

describe("layer labels on a node", () => {
  const JOB = {
    id: "scan",
    stage: { value: "test", origin: { kind: "local" } },
    needs: null,
    environment: null,
    extends: [],
    opaque: [],
    signals: { image: null, script: [] },
    range: { start: 0, end: 1 },
    file: ".gitlab-ci.yml",
  } satisfies Job;

  const PIPELINE: Pipeline = {
    stages: [{ name: "test", implicit: false, range: null, file: ".gitlab-ci.yml" }],
    jobs: [JOB],
    templates: [],
    opaque: [],
    main: ".gitlab-ci.yml",
    files: [".gitlab-ci.yml"],
    unresolved: [],
  };

  function node(overlay: Parameters<typeof toFlowGraph>[5]) {
    const graph = toFlowGraph(
      {
        nodes: [{ id: "scan", x: 0, y: 0, width: 200, height: 64 }],
        columns: [],
        edges: [],
        height: 64,
      },
      PIPELINE,
      null,
      0,
      0,
      overlay,
    );
    const data = graph.nodes.find((entry) => entry.id === "scan")?.data as JobNodeData;
    render(
      <ReactFlowProvider>
        <JobNode {...({ id: "scan", data } as JobNodeProps)} />
      </ReactFlowProvider>,
    );
    return screen.getByRole("button", { name: /scan/ });
  }

  test("outside the overlay, no labels", () => {
    expect(node(null).textContent).not.toContain("SAST");
  });

  test("on the overlay, each layer's word, never colour alone", () => {
    const button = node({ jobs: new Map([["scan", ["sast"]]]), selected: null });
    expect(button.textContent).toContain("SAST");
    expect(within(button).getByText("SAST").getAttribute("data-family")).toBe("build");
  });

  test("the screen reader hears the full layer names", () => {
    const button = node({ jobs: new Map([["scan", ["sast", "sca"]]]), selected: null });
    const description = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain(
      "Layers: Static analysis, Software composition analysis.",
    );
  });

  test("beyond two, the rest is counted", () => {
    const button = node({ jobs: new Map([["scan", ["sast", "sca", "iac"]]]), selected: null });
    expect(button.textContent).toContain("+1");
    expect(button.textContent).not.toContain("IaC");
  });

  test("on the overlay, the stage gives way: the column already says it", () => {
    expect(node({ jobs: new Map([["scan", ["sast"]]]), selected: null }).textContent).not.toContain(
      "test",
    );
  });

  test("the chosen layer comes first, otherwise it would stay behind the counter", () => {
    const button = node({ jobs: new Map([["scan", ["sast", "sca", "dast"]]]), selected: "dast" });
    expect(button.textContent).toContain("DAST");
  });

  test("the chosen layer highlights the job", () => {
    expect(
      node({ jobs: new Map([["scan", ["sast"]]]), selected: "sast" }).getAttribute(
        "data-emphasised",
      ),
    ).toBe("true");
    cleanup();
    expect(
      node({ jobs: new Map([["scan", ["sast"]]]), selected: "dast" }).getAttribute(
        "data-emphasised",
      ),
    ).toBe("false");
  });
});

describe("catalogue", () => {
  const TOOLS = [
    tool("a", { layers: ["sast"], license: "MIT" }),
    tool("b", {
      layers: ["dast"],
      license: "Proprietary",
      snippets: { gitlab: null, github: "- run: b\n" },
    }),
    tool("c", { layers: ["sast", "sca"], license: "BUSL-1.1", logo: "c" }),
  ];
  const LOGOS = { c: { path: "M0 0h24v24H0z" } };

  const renderCatalog = (initialLayer: LayerId | null = null) =>
    render(
      <CatalogView
        catalog={{ layers: [...LAYERS], tools: TOOLS, logos: LOGOS }}
        initialLayer={initialLayer}
      />,
    );

  const ids = (filter: Parameters<typeof filterTools>[1]) =>
    filterTools(TOOLS, filter).map((entry) => entry.id);

  test("the three filters, separately and together", () => {
    const all = { layer: "any", license: "any", adapter: "any" } as const;
    expect(ids(all)).toEqual(["a", "b", "c"]);
    expect(ids({ ...all, layer: "sast" })).toEqual(["a", "c"]);
    expect(ids({ ...all, license: "open" })).toEqual(["a"]);
    expect(ids({ ...all, license: "other" })).toEqual(["b", "c"]);
    expect(ids({ ...all, adapter: "github" })).toEqual(["b"]);
    expect(ids({ ...all, layer: "sast", adapter: "gitlab", license: "open" })).toEqual(["a"]);
  });

  test("the layer filter applies on screen, and the count follows", async () => {
    renderCatalog();
    expect(screen.getByTestId("catalog-count").textContent).toBe("3 of 3 tools");
    await userEvent.selectOptions(screen.getByLabelText("Layer"), "dast");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
    expect(screen.queryByRole("button", { name: /^A/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^B/ })).toBeDefined();
  });

  test("the licence and adapter filters apply on screen", async () => {
    renderCatalog();
    await userEvent.selectOptions(screen.getByLabelText("License"), "open");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
    await userEvent.selectOptions(screen.getByLabelText("License"), "any");
    await userEvent.selectOptions(screen.getByLabelText("Adapter"), "github");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
  });

  test('"See tools" opens the catalogue filtered on its layer', () => {
    renderCatalog("dast");
    expect((screen.getByLabelText("Layer") as HTMLSelectElement).value).toBe("dast");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
  });

  test("no results says so", async () => {
    renderCatalog();
    await userEvent.selectOptions(screen.getByLabelText("Layer"), "iast");
    expect(screen.getByText("No tool matches these filters.")).toBeDefined();
  });

  test("a filter's result is announced to screen readers", () => {
    renderCatalog();
    expect(screen.getByTestId("catalog-count").getAttribute("role")).toBe("status");
  });

  test("tools are sorted by name, case-insensitively", () => {
    render(
      <CatalogView
        catalog={{
          layers: [...LAYERS],
          tools: [tool("z", { name: "Zeta" }), tool("a", { name: "alpha" })],
          logos: {},
        }}
        initialLayer={null}
      />,
    );
    expect(
      screen.getAllByRole("button", { pressed: false }).map((entry) => entry.textContent),
    ).toEqual(["alpha", "Zeta"]);
  });

  test("the entry states the licence, its kind, the verification and the snippet", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: /^C/ }));

    const card = screen.getByRole("region", { name: "Tool detail" });
    expect(within(card).getByTestId("tool-license").textContent).toBe("BUSL-1.1 · not open source");
    expect(within(card).getByText("BUSL-1.1").className).toContain("font-mono");
    expect(within(card).getByRole("link", { name: "2026-11-04" }).getAttribute("href")).toBe(
      "https://exemple.org/verif",
    );
    expect(within(card).getByRole("link", { name: "Homepage" })).toBeDefined();
    expect(card.textContent).toContain("script: x");
    expect(card.textContent).toContain("No GitHub Actions snippet.");
    expect(card.querySelector('svg path[d="M0 0h24v24H0z"]')).not.toBeNull();
  });

  test("the entry says whether the tool runs as a job or as a service", async () => {
    render(
      <CatalogView
        catalog={{
          layers: [...LAYERS],
          tools: [tool("s", { kind: "service", name: "Serveur" })],
          logos: {},
        }}
        initialLayer={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Serveur" }));
    expect(screen.getByRole("region", { name: "Tool detail" }).textContent).toContain(
      "Runs as a service",
    );
  });

  test("a tool without a logo carries the generic mark", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: /^A/ }));
    const heading = within(screen.getByRole("region", { name: "Tool detail" })).getByRole(
      "heading",
      {
        level: 2,
      },
    );
    expect(heading.querySelector("svg")?.getAttribute("fill")).toBe("none");
  });

  test("the entry closes", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: /^A/ }));
    await userEvent.click(screen.getByRole("button", { name: "Close tool detail" }));
    expect(screen.queryByRole("region", { name: "Tool detail" })).toBeNull();
  });
});

describe("diagnostics panel and partial banner", () => {
  const DIAGNOSTICS = [
    {
      code: "INCLUDE_UNRESOLVED",
      severity: "info",
      params: { form: "template", detail: "x" },
      range: null,
      file: "a",
    },
    {
      code: "UNKNOWN_NEED",
      severity: "error",
      params: { job: "a", need: "b" },
      range: null,
      file: "a",
    },
  ] as const;

  /** The same absence was announced twice on one screen. The filter is on severity: the UI does
   *  not handle codes one by one. */
  test("info diagnostics step aside when the banner states them, and the count follows", () => {
    render(
      <DiagnosticsPanel
        diagnostics={[...DIAGNOSTICS]}
        onSelectRange={() => undefined}
        main="a"
        omitInfo
      />,
    );
    expect(screen.queryByText("INCLUDE_UNRESOLVED")).toBeNull();
    expect(screen.getByText("UNKNOWN_NEED")).toBeDefined();
    expect(screen.getByRole("region", { name: "Diagnostics" }).textContent).toContain("1");
  });

  test("without the banner, they stay", () => {
    render(
      <DiagnosticsPanel diagnostics={[...DIAGNOSTICS]} onSelectRange={() => undefined} main="a" />,
    );
    expect(screen.getByText("INCLUDE_UNRESOLVED")).toBeDefined();
  });
});
