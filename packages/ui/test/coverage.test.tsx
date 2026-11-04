import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Coverage, Tool } from "@keelson/catalog";
import type { Job, Pipeline } from "@keelson/core";
import { LAYERS, type LayerId } from "@keelson/taxonomy";
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
    detect: { images: [], scripts: [] },
    snippets: { gitlab: "a:\n  script: x\n", github: null },
    lastVerified: "2026-11-04",
    ...overrides,
  };
}

describe("panneau de couverture", () => {
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

  test("compte les couches couvertes sur les vingt et une", () => {
    renderPanel(coverage({ sast: ["a"], sca: ["b"] }));
    expect(screen.getByTestId("coverage-count").textContent).toBe(
      "2 of 13 OWASP layers covered, 0 of 8 platform categories seen",
    );
  });

  test("une couche non couverte donne son résumé, et son chemin vers les outils", async () => {
    const { onShowTools } = renderPanel(coverage({ sast: ["a"] }));
    const uncovered = screen.getByRole("region", { name: "Uncovered OWASP layers" });

    expect(within(uncovered).getByText("Dynamic testing")).toBeDefined();
    expect(
      within(uncovered).getByText("Attacks a running application from the outside."),
    ).toBeDefined();
    expect(within(uncovered).queryByText("Static analysis")).toBeNull();

    const row = within(uncovered).getByText("Dynamic testing").closest("li");
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "See tools" }));
    expect(onShowTools).toHaveBeenCalledWith("dast");
  });

  test("une couche OWASP cite la Guideline, une catégorie plateforme non", () => {
    renderPanel(coverage({}));
    const uncovered = screen.getByRole("region", { name: "Uncovered OWASP layers" });
    const rowOf = (name: string) => within(uncovered).getByText(name).closest("li") as HTMLElement;

    const link = within(rowOf("Dynamic testing")).getByRole("link", { name: "OWASP guideline" });
    expect(link.getAttribute("href")).toContain("2-4-2-Dynamic-Application-Security-Testing.md");
    const platform = screen.getByRole("region", { name: "Platform categories not seen" });
    const row = within(platform).getByText("Source control").closest("li") as HTMLElement;
    expect(within(row).queryByRole("link")).toBeNull();
  });

  test("choisir une couche couverte la met en avant, et le bouton le dit", async () => {
    const { onSelect } = renderPanel(coverage({ sast: ["a", "b"] }), "sast");
    const button = screen.getByRole("button", { name: /Static analysis/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("a, b");
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("sast");
  });

  /** Une catégorie plateforme vit autour du pipeline : sur un dépôt GitLab, « Source control » n'est
   *  pas une lacune de sécurité, et le compte unique mêlait les deux référentiels. */
  test("une catégorie plateforme non vue n'est pas une couche OWASP non couverte", () => {
    renderPanel(coverage({}));
    const owasp = screen.getByRole("region", { name: "Uncovered OWASP layers" });
    const platform = screen.getByRole("region", { name: "Platform categories not seen" });
    expect(within(owasp).queryByText("Source control")).toBeNull();
    expect(within(platform).getByText("Source control")).toBeDefined();
  });

  test("un pipeline partiel fait de la couverture une borne basse, à l'écran", () => {
    renderPanel(coverage({}, true));
    expect(screen.getByTestId("coverage-lower-bound").textContent).toBe(LOWER_BOUND_NOTE);
  });

  test("un pipeline complet ne le dit pas", () => {
    renderPanel(coverage({}));
    expect(screen.queryByTestId("coverage-lower-bound")).toBeNull();
  });
});

describe("étiquettes de couche sur un nœud", () => {
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

  test("hors de l'overlay, aucune étiquette", () => {
    expect(node(null).textContent).not.toContain("SAST");
  });

  test("sur l'overlay, le mot de chaque couche, jamais la couleur seule", () => {
    const button = node({ jobs: new Map([["scan", ["sast"]]]), selected: null });
    expect(button.textContent).toContain("SAST");
    expect(within(button).getByText("SAST").getAttribute("data-family")).toBe("build");
  });

  test("le lecteur d'écran entend les noms complets des couches", () => {
    const button = node({ jobs: new Map([["scan", ["sast", "sca"]]]), selected: null });
    const description = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain(
      "Layers: Static analysis, Software composition analysis.",
    );
  });

  test("au-delà de deux, le reste se compte", () => {
    const button = node({ jobs: new Map([["scan", ["sast", "sca", "iac"]]]), selected: null });
    expect(button.textContent).toContain("+1");
    expect(button.textContent).not.toContain("IaC");
  });

  test("sur l'overlay, le stage laisse sa place : la colonne le dit déjà", () => {
    expect(node({ jobs: new Map([["scan", ["sast"]]]), selected: null }).textContent).not.toContain(
      "test",
    );
  });

  test("la couche choisie passe devant, sinon elle resterait derrière le compteur", () => {
    const button = node({ jobs: new Map([["scan", ["sast", "sca", "dast"]]]), selected: "dast" });
    expect(button.textContent).toContain("DAST");
  });

  test("la couche choisie met le job en avant", () => {
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
  const LOGOS = { c: { title: "C", path: "M0 0h24v24H0z" } };

  const renderCatalog = (initialLayer: LayerId | null = null) =>
    render(
      <CatalogView
        catalog={{ layers: [...LAYERS], tools: TOOLS, logos: LOGOS }}
        initialLayer={initialLayer}
      />,
    );

  const ids = (filter: Parameters<typeof filterTools>[1]) =>
    filterTools(TOOLS, filter).map((entry) => entry.id);

  test("les trois filtres, séparément et ensemble", () => {
    const all = { layer: "any", license: "any", adapter: "any" } as const;
    expect(ids(all)).toEqual(["a", "b", "c"]);
    expect(ids({ ...all, layer: "sast" })).toEqual(["a", "c"]);
    expect(ids({ ...all, license: "open" })).toEqual(["a"]);
    expect(ids({ ...all, license: "other" })).toEqual(["b", "c"]);
    expect(ids({ ...all, adapter: "github" })).toEqual(["b"]);
    expect(ids({ ...all, layer: "sast", adapter: "gitlab", license: "open" })).toEqual(["a"]);
  });

  test("le filtre de couche s'applique à l'écran, et le compte suit", async () => {
    renderCatalog();
    expect(screen.getByTestId("catalog-count").textContent).toBe("3 of 3 tools");
    await userEvent.selectOptions(screen.getByLabelText("Layer"), "dast");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
    expect(screen.queryByRole("button", { name: /^A/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^B/ })).toBeDefined();
  });

  test("les filtres de licence et d'adaptateur s'appliquent à l'écran", async () => {
    renderCatalog();
    await userEvent.selectOptions(screen.getByLabelText("License"), "open");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
    await userEvent.selectOptions(screen.getByLabelText("License"), "any");
    await userEvent.selectOptions(screen.getByLabelText("Adapter"), "github");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
  });

  test("« See tools » ouvre le catalogue filtré sur sa couche", () => {
    renderCatalog("dast");
    expect((screen.getByLabelText("Layer") as HTMLSelectElement).value).toBe("dast");
    expect(screen.getByTestId("catalog-count").textContent).toBe("1 of 3 tools");
  });

  test("aucun résultat le dit", async () => {
    renderCatalog();
    await userEvent.selectOptions(screen.getByLabelText("Layer"), "iast");
    expect(screen.getByText("No tool matches these filters.")).toBeDefined();
  });

  test("le résultat d'un filtre est annoncé aux lecteurs d'écran", () => {
    renderCatalog();
    expect(screen.getByTestId("catalog-count").getAttribute("role")).toBe("status");
  });

  test("les outils sont triés par nom, sans tenir compte de la casse", () => {
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

  test("la fiche dit la licence, sa nature, la vérification et le snippet", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: /^C/ }));

    const card = screen.getByRole("region", { name: "Tool detail" });
    expect(within(card).getByTestId("tool-license").textContent).toBe("BUSL-1.1 · not open source");
    expect(within(card).getByRole("link", { name: "2026-11-04" }).getAttribute("href")).toBe(
      "https://exemple.org/verif",
    );
    expect(within(card).getByRole("link", { name: "Homepage" })).toBeDefined();
    expect(card.textContent).toContain("script: x");
    expect(card.textContent).toContain("No GitHub Actions snippet.");
    expect(card.querySelector('svg path[d="M0 0h24v24H0z"]')).not.toBeNull();
  });

  test("un outil sans logo porte la marque générique", async () => {
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

  test("la fiche se referme", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: /^A/ }));
    await userEvent.click(screen.getByRole("button", { name: "Close tool detail" }));
    expect(screen.queryByRole("region", { name: "Tool detail" })).toBeNull();
  });
});

describe("panneau de diagnostics et bande partielle", () => {
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

  /** La même absence était annoncée deux fois sur un écran. Le filtre porte sur la sévérité : l'UI
   *  ne traite pas les codes un par un. */
  test("les informations s'effacent quand la bande les dit, et le compte suit", () => {
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

  test("sans bande, elles restent", () => {
    render(
      <DiagnosticsPanel diagnostics={[...DIAGNOSTICS]} onSelectRange={() => undefined} main="a" />,
    );
    expect(screen.getByText("INCLUDE_UNRESOLVED")).toBeDefined();
  });
});
