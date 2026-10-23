import { afterEach, describe, expect, test } from "bun:test";
import type { Job, Pipeline, Stage, UnresolvedInclude } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { JobEditor } from "../src/editing/JobEditor.tsx";
import { StageControls } from "../src/editing/StageControls.tsx";
import { JobDetailPanel } from "../src/panels/JobDetailPanel.tsx";
import type { Draft } from "../src/state/store.ts";
import { PartialPipelineBar } from "../src/states/PartialPipelineBar.tsx";
import { type JobNodeData, toFlowGraph } from "../src/views/pipeline/graph.ts";
import { JobNode, type JobNodeProps } from "../src/views/pipeline/JobNode.tsx";
import type { Layout } from "../src/views/pipeline/layout.ts";

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

describe("un job inclus dans la vue Pipeline", () => {
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
      throw new Error(`nœud ${id} absent du graphe`);
    }
    return found.data as JobNodeData;
  }

  /** `JobNode` lit le contexte de xyflow par ses `Handle` : sans le provider, le rendu lève. */
  function renderNode(id: string) {
    return render(
      <ReactFlowProvider>
        {/* `JobNode` n'utilise que `data` ; le reste de `NodeProps` est fourni par xyflow en
            production et n'a aucun effet sur ce que ce test mesure. */}
        <JobNode {...({ id, data: nodeData(id) } as JobNodeProps)} />
      </ReactFlowProvider>,
    );
  }

  test("le graphe marque le job venu d'un fichier inclus", () => {
    expect(nodeData("sast").included).toBe(true);
    expect(nodeData("sast").file).toBe(INCLUDED);
    expect(nodeData("local-job").included).toBe(false);
  });

  /** La promesse est que la marque **n'est pas la couleur seule** : le mot `read-only` est dans le
   *  DOM rendu, et il y est aussi quand le ton de surface change. Un test qui ne vérifierait que la
   *  classe de fond laisserait passer un nœud teinté mais muet. */
  test("le nœud rend le mot read-only et le dit à un lecteur d'écran", () => {
    renderNode("sast");

    expect(screen.getByText("read-only")).toBeDefined();
    const button = screen.getByRole("button", { name: /sast/ });
    expect(button.getAttribute("data-included")).toBe("true");
    expect(button.getAttribute("title")).toContain(INCLUDED);

    const described = button.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toContain(
      `From included file ${INCLUDED}. Read-only.`,
    );
  });

  test("un job du fichier principal ne porte aucune de ces marques", () => {
    renderNode("local-job");
    expect(screen.queryByText("read-only")).toBeNull();
    const button = screen.getByRole("button", { name: /local-job/ });
    expect(button.getAttribute("data-included")).toBe("false");
    expect(button.getAttribute("title")).toBeNull();
  });
});

describe("le panneau de détail d'un job inclus", () => {
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

  test("nomme le fichier source et porte la raison en toutes lettres", () => {
    renderPanel(job("sast", INCLUDED));

    expect(screen.getByTestId("job-source-file").textContent).toContain(INCLUDED);
    // Le mot est cherché **dans le titre** : l'en-tête de chaque bloc opaque porte le même mot,
    // donc une recherche sur tout le document ne mesurerait pas la marque du job.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("read-only");
    const described = screen
      .getByRole("region", { name: "Job detail" })
      .getAttribute("aria-describedby");
    expect(document.getElementById(described ?? "")?.textContent).toBe(
      "This job is defined in an included file. Keelson never writes to included files, so it cannot be edited here. Open that file in your own editor to change it.",
    );
  });

  /** Le défaut que ce test empêche : `sliceOpaque` découpait le texte du fichier **principal**.
   *  Les deux textes ci-dessous ont la même longueur et des octets différents au même offset —
   *  sans quoi le test passerait avec le mauvais fichier, et l'écran afficherait un fragment pris
   *  ailleurs sous la seule promesse « ceci est verbatim ». */
  test("un bloc opaque est découpé dans le texte de son fichier", () => {
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

  test("un job du fichier principal n'a pas de note de verrou", () => {
    renderPanel(job("local-job"));
    expect(
      screen.getByRole("region", { name: "Job detail" }).getAttribute("aria-describedby"),
    ).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).not.toContain("read-only");
  });
});

describe("les contrôles d'édition d'un job inclus", () => {
  function renderEditor(target: Job, lockedTo: string | null) {
    const drafts: Draft[] = [];
    render(
      <JobEditor
        job={target}
        pipeline={pipeline()}
        onSubmit={(draft) => drafts.push(draft)}
        lockedTo={lockedTo}
      />,
    );
    return drafts;
  }

  test("tous les contrôles sont désactivés, aucun n'est retiré", () => {
    renderEditor(job("sast", INCLUDED), INCLUDED);

    const group = screen.getByRole("group", { name: "Job editor" });
    const controls = [...group.querySelectorAll("input, select, button")];
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.filter((control) => !control.hasAttribute("disabled"))).toEqual([]);
  });

  /** Ce que ce test mesure, exactement : `disabled` coupe les boutons d'action, et le seul
   *  formulaire du composant — le renommage — ne soumet rien.
   *
   *  Ce qu'il ne mesure **pas** : `guard()`, la seconde barrière. Aucun test d'ici ne peut
   *  l'isoler, parce que tous les chemins qui y mènent passent par un contrôle désactivé —
   *  neutraliser `guard()` seul laisse donc la suite verte, vérifié. C'est de la défense en
   *  profondeur, pas une protection testée, et le dire autrement serait surestimer.
   *
   *  On ne peut pas non plus taper un nouveau nom puis soumettre : un champ désactivé n'accepte
   *  rien, donc un tel test ne dirait rien du verrou. */
  test("aucun clic sur un bouton d'action ne produit de brouillon", async () => {
    const drafts = renderEditor(job("sast", INCLUDED), INCLUDED);

    await userEvent.click(screen.getByRole("button", { name: /add need/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete job/i }));
    await userEvent.click(screen.getByRole("button", { name: /^rename$/i }));

    expect(drafts).toEqual([]);
  });

  test("la raison est portée par le groupe et présente dans le DOM", () => {
    renderEditor(job("sast", INCLUDED), INCLUDED);

    const described = screen
      .getByRole("group", { name: "Job editor" })
      .getAttribute("aria-describedby");
    expect(document.getElementById(described ?? "")?.textContent).toBe(
      `Editing is off for this job. It is defined in ${INCLUDED}, and Keelson never writes to included files.`,
    );
  });

  test("sans verrou, les contrôles restent actifs et la raison est absente", () => {
    renderEditor(job("local-job"), null);

    const group = screen.getByRole("group", { name: "Job editor" });
    expect(group.getAttribute("aria-describedby")).toBeNull();
    expect([...group.querySelectorAll("button")].some((b) => !b.hasAttribute("disabled"))).toBe(
      true,
    );
  });
});

describe("les contrôles de stages quand la liste vient d'un include", () => {
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

  test("tout est désactivé et la raison nomme le fichier", () => {
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

  test("une liste du fichier principal reste éditable", () => {
    renderStages(MAIN);
    expect(
      [...document.querySelectorAll("button")].some((button) => !button.hasAttribute("disabled")),
    ).toBe(true);
  });
});

describe("l'indicateur de pipeline partiel", () => {
  const remote: UnresolvedInclude = {
    form: "remote",
    detail: "https://exemple.org/ci.yml",
    from: MAIN,
    range: { start: 12, end: 44 },
  };

  function renderBar(unresolved: UnresolvedInclude[], onSelect = (_f: string, _r: unknown) => {}) {
    return render(
      <PartialPipelineBar
        pipeline={pipeline({ unresolved })}
        onSelectRange={(file, range) => onSelect(file, range)}
      />,
    );
  }

  test("absent quand tous les includes sont résolus", () => {
    const { container } = renderBar([]);
    expect(container.textContent).toBe("");
  });

  test("présent et nommé dès qu'un include ne l'est pas", () => {
    renderBar([remote]);
    expect(screen.getByRole("group", { name: "Partial pipeline" })).toBeDefined();
    expect(
      screen.getByText("Some includes are not resolved, so jobs may be missing from this view."),
    ).toBeDefined();
    expect(screen.getByText("1 unresolved include")).toBeDefined();
  });

  test("le compte s'accorde au pluriel", () => {
    renderBar([remote, { ...remote, form: "template", detail: "Jobs/SAST.gitlab-ci.yml" }]);
    expect(screen.getByText("2 unresolved includes")).toBeDefined();
  });

  /** « L'UI doit le dire plutôt que le masquer » n'est tenu que si elle dit **quoi** manque : la
   *  forme et la valeur écrite, pas seulement qu'il manque quelque chose. */
  test("chaque entrée nomme sa forme, sa valeur et le fichier qui la déclare", () => {
    renderBar([remote]);
    expect(screen.getByText("remote")).toBeDefined();
    expect(screen.getByText("https://exemple.org/ci.yml")).toBeDefined();
    expect(screen.getByText("declared in")).toBeDefined();
    expect(screen.getByText(MAIN)).toBeDefined();
  });

  /** Les trois séparations d'avec `NoticeBar`, qui annonce la conséquence d'une action : une
   *  lacune n'est pas un événement, donc pas de région live, et un fait ne se congédie pas. */
  test("ce n'est ni une alerte, ni un statut, et rien ne se congédie", () => {
    renderBar([remote]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  test("une entrée avec plage est un bouton qui remonte son fichier et sa plage", async () => {
    const picked: { file: string; range: unknown }[] = [];
    renderBar([remote], (file, range) => picked.push({ file, range }));

    await userEvent.click(screen.getByRole("button", { name: /exemple\.org/ }));
    expect(picked).toEqual([{ file: MAIN, range: { start: 12, end: 44 } }]);
  });

  test("une entrée sans plage ne feint pas d'être cliquable", () => {
    renderBar([{ ...remote, range: null }]);
    expect(screen.queryByRole("button", { name: /exemple\.org/ })).toBeNull();
  });

  test("le résumé est atteignable au clavier", () => {
    renderBar([remote]);
    const summary = document.querySelector("summary");
    summary?.focus();
    expect(document.activeElement).toBe(summary);
  });
});
