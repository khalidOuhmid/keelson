import { afterEach, describe, expect, test } from "bun:test";
import type { Job, Pipeline, Stage, UnresolvedInclude } from "@keelson/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { JobEditor } from "../src/editing/JobEditor.tsx";
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
   *  classe de fond laisserait passer un nœud teinté mais muet.
   *
   *  Pas de `title` : mesuré par la passe d'audit, le texte d'un `title` n'apparaît **nulle part**
   *  dans l'arbre d'accessibilité quand un `aria-describedby` est présent — ni en nom, ni en
   *  description. Deux formulations du même fait coexistaient, dont une seule était jamais lue, et
   *  celle-là n'était atteignable qu'à la souris. */
  test("le nœud rend le mot read-only et le dit à un lecteur d'écran", () => {
    renderNode("sast");

    expect(screen.getByText("read-only")).toBeDefined();
    const button = screen.getByRole("button", { name: /sast/ });
    expect(button.getAttribute("data-included")).toBe("true");
    const described = button.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toContain(
      `From included file ${INCLUDED}. Read-only.`,
    );
  });

  /** Mesuré par la passe `critique` de L2b : le badge occupait 178 px d'une ligne de 205 et
   *  réduisait le stage à 23 px tronqués. Il est donc absent d'un nœud inclus, et reste sur un nœud
   *  du fichier principal, où il n'est pas redondant avec `read-only`. */
  test("le badge d'origine n'est pas sur un nœud inclus", () => {
    renderNode("sast");
    expect(screen.queryByTestId("origin-badge")).toBeNull();
  });

  test("le badge d'origine reste sur un nœud du fichier principal", () => {
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

  test("un job du fichier principal ne porte aucune de ces marques", () => {
    renderNode("local-job");
    expect(screen.queryByText("read-only")).toBeNull();
    const button = screen.getByRole("button", { name: /local-job/ });
    expect(button.getAttribute("data-included")).toBe("false");
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

  test("le fichier source n'est nommé que s'il n'est pas le fichier principal", () => {
    renderPanel(job("local-job"));
    expect(screen.queryByTestId("job-source-file")).toBeNull();
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

  /** Le formulaire entier disparaît : des champs vides et des cases cochées par défaut se liraient
   *  comme l'état d'un job qu'on ne peut de toute façon pas écrire. */
  test("un job inclus ne rend aucun contrôle, seulement la raison", () => {
    const { container } = render(
      <JobEditor
        job={job("sast", INCLUDED)}
        pipeline={pipeline()}
        onSubmit={() => undefined}
        lockedTo={INCLUDED}
      />,
    );
    expect(container.querySelectorAll("input, select, button, form")).toHaveLength(0);
    expect(container.textContent).toBe(
      `Editing is off for this job. It is defined in ${INCLUDED}, and Keelson never writes to included files.`,
    );
  });

  test("sans verrou, les contrôles restent actifs et la raison est absente", () => {
    renderEditor(job("local-job"), null);

    const group = screen.getByRole("group", { name: "Job editor" });
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

  function renderBar(unresolved: UnresolvedInclude[]) {
    return render(<PartialPipelineBar pipeline={pipeline({ unresolved })} />);
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

  /** Aucune entrée n'est cliquable. La première version en faisait un bouton appelant
   *  `selectByRange`, et c'était un clic mort : la plage d'un include tombe dans le bloc opaque de
   *  la clé `include` de premier niveau, que `selectByRange` ne peut jamais apparier à un job.
   *  Le seul contrôle de la bande est le `summary`. */
  test("aucune entrée n'est un contrôle", () => {
    renderBar([remote]);
    expect(screen.queryByRole("button", { name: /exemple\.org/ })).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  /** Ce test mesure la **focalisabilité** du résumé, et rien de plus : `happy-dom` n'implémente pas
   *  le basculement natif de `<details>` à la touche Entrée, donc l'asserter ici mesurerait le DOM
   *  simulé et non le produit. Le dépliage au clavier est vérifié sur le vrai navigateur, dans
   *  `e2e/includes.e2e.ts`. La première version de ce test appelait `.focus()` et s'arrêtait là
   *  sans le dire. */
  test("le résumé est focalisable au clavier", () => {
    renderBar([remote]);

    const summary = document.querySelector("summary");
    expect(summary).not.toBeNull();
    summary?.focus();
    expect(document.activeElement).toBe(summary);
  });
});

describe("le texte d'aide du badge d'origine, dans le panneau de détail", () => {
  /** Le texte dépend du job **et** de l'origine. Le premier correctif ne regardait que l'origine, et
   *  disait « cannot be overridden here » sur un job surchargé dans le fichier principal, qui reste
   *  éditable : l'erreur avait changé de côté. Ces tests passent par le panneau parce que c'est lui
   *  qui sait si le job est éditable, et qu'un test sur le badge seul ne verrait pas l'oubli. */
  function hintOn(target: Job): string | null {
    render(<JobDetailPanel job={target} textOf={() => ""} main={MAIN} onClose={() => undefined} />);
    return screen.getByTestId("origin-badge").getAttribute("title");
  }

  const includeOrigin = { kind: "include", file: INCLUDED } as const;
  const extendsOrigin = { kind: "extends", template: ".base" } as const;

  test("job du fichier principal, valeur venue d'un include : la surcharge s'écrit ici", () => {
    const hint = hintOn(job("compile", MAIN, { stage: { value: "build", origin: includeOrigin } }));
    expect(hint).toBe(
      "This value comes from an included file. Changing it writes an explicit override in this job and never touches that file.",
    );
  });

  test("job du fichier principal, valeur héritée d'un template : le texte d'origine", () => {
    const hint = hintOn(job("compile", MAIN, { stage: { value: "build", origin: extendsOrigin } }));
    expect(hint).toBe(ORIGIN_HINT);
  });

  test("job inclus, valeur venue d'un include : rien ne se surcharge", () => {
    const hint = hintOn(job("sast", INCLUDED));
    expect(hint).toBe(
      "This job is defined in an included file. Keelson never writes to included files, so this value cannot be overridden here.",
    );
  });

  /** Les trois champs, un par un : le texte passe par trois appels distincts de `Field`, et un test
   *  sur le seul stage laissait les deux autres sans aucune garde. */
  test("Stage, Needs et Environment portent tous le même refus sur un job inclus", () => {
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

  /** Le cas que regarder l'origine seule ne pouvait pas voir : un job inclus dont la valeur vient
   *  d'un `extends` portait `ORIGIN_HINT`, qui promet une surcharge impossible. */
  test("job inclus, valeur héritée d'un template : rien ne se surcharge non plus", () => {
    const hint = hintOn(
      job("sast", INCLUDED, { stage: { value: "build", origin: extendsOrigin } }),
    );
    expect(hint).toBe(READ_ONLY_ORIGIN_HINT);
  });
});
