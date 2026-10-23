import { describe, expect, test } from "bun:test";
import { hashText, type Operation } from "@keelson/core";
import { apply } from "../../src/apply.ts";
import type { IncludeReader } from "../../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../../src/parse.ts";
import type { Draft } from "../support/apply.ts";

function reader(files: Record<string, string>): IncludeReader {
  return { read: (path) => files[path] ?? null, candidates: () => Object.keys(files) };
}

type Tree = Record<string, string>;

function run(files: Tree, draft: Draft) {
  const text = files[GITLAB_CI_FILE] ?? "";
  const parsed = parse(text, { file: GITLAB_CI_FILE, read: reader(files) });
  const operation = { v: 1, baseHash: hashText(text), ...draft } as Operation;
  return { parsed, result: apply(parsed.document, operation) };
}

/** Refus attendu, et **rien d'écrit** : `apply` ne touche pas au disque, donc le seul témoin est
 *  que le texte rendu reste celui d'entrée — vérifié ici par l'absence de `value`. */
function expectRefusal(files: Tree, draft: Draft) {
  const { result } = run(files, draft);
  if (result.ok) {
    throw new Error(`opération acceptée alors qu'on attendait un refus : ${JSON.stringify(draft)}`);
  }
  expect(result.error.code).toBe("FROM_INCLUDED_FILE");
  return result.error;
}

const TREE: Tree = {
  [GITLAB_CI_FILE]: [
    "include: ci/jobs.yml",
    "",
    "stages:",
    "  - build",
    "  - test",
    "",
    "local-job:",
    "  stage: test",
    "  script:",
    "    - make check",
    "",
  ].join("\n"),
  "ci/jobs.yml": [
    "compile:",
    "  stage: build",
    "  script:",
    "    - make",
    "",
    ".base:",
    "  stage: build",
    "",
  ].join("\n"),
};

describe("toute opération visant un job inclus est refusée", () => {
  const cases: { label: string; draft: Draft }[] = [
    { label: "removeJob", draft: { kind: "removeJob", id: "compile" } },
    { label: "renameJob", draft: { kind: "renameJob", from: "compile", to: "autre" } },
    { label: "setJobStage", draft: { kind: "setJobStage", id: "compile", stage: "test" } },
    { label: "addNeed", draft: { kind: "addNeed", id: "compile", need: { job: "local-job" } } },
    { label: "removeNeed", draft: { kind: "removeNeed", id: "compile", job: "local-job" } },
    {
      label: "setEnvironment",
      draft: { kind: "setEnvironment", id: "compile", environment: { name: "prod" } },
    },
  ];

  for (const entry of cases) {
    test(`${entry.label} rend FROM_INCLUDED_FILE et nomme le fichier`, () => {
      expect(expectRefusal(TREE, entry.draft).params).toEqual({
        reason: "job",
        job: "compile",
        file: "ci/jobs.yml",
      });
    });
  }

  /** La distinction qui compte : un job inclus **surchargé** dans le fichier principal appartient
   *  au fichier principal, donc il reste éditable. C'est l'ordre de fusion de GitLab, et c'est
   *  aussi ce qu'un utilisateur attend du fichier qu'il a sous les yeux. */
  test("un job inclus puis surchargé dans le fichier principal reste éditable", () => {
    const overridden: Tree = {
      ...TREE,
      [GITLAB_CI_FILE]: `${TREE[GITLAB_CI_FILE]}\ncompile:\n  stage: test\n`,
    };
    const { result } = run(overridden, { kind: "setJobStage", id: "compile", stage: "build" });
    expect(result.ok).toBe(true);
  });

  test("un job qui n'existe nulle part reste JOB_NOT_FOUND, pas FROM_INCLUDED_FILE", () => {
    const { result } = run(TREE, { kind: "removeJob", id: "fantome" });
    expect(result.ok ? null : result.error.code).toBe("JOB_NOT_FOUND");
  });
});

describe("noms déjà pris dans un fichier inclus", () => {
  test("addJob sur un nom venu d'un include est refusé plutôt que surchargé", () => {
    expect(
      expectRefusal(TREE, {
        kind: "addJob",
        job: { id: "compile", stage: "test", script: ["make"] },
      }).params,
    ).toEqual({ reason: "nameTaken", name: "compile", file: "ci/jobs.yml" });
  });

  /** Un nom de template est refusé **avant** d'arriver au contrôle d'include : `.base` n'est pas
   *  un nom de job légal chez GitLab, où que la clé vive. Le test est ici pour fixer l'ordre des
   *  refus, pas pour couvrir les includes. */
  test("un nom de template reste INVALID_NAME, pas un conflit d'include", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: ".base", stage: "test", script: ["make"] },
    });
    expect(result.ok ? null : result.error.code).toBe("INVALID_NAME");
  });

  test("renameJob vers un nom venu d'un include est refusé", () => {
    expect(
      expectRefusal(TREE, { kind: "renameJob", from: "local-job", to: "compile" }).params,
    ).toEqual({ reason: "nameTaken", name: "compile", file: "ci/jobs.yml" });
  });

  test("addJob sur un nom libre partout passe", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    expect(result.ok).toBe(true);
  });
});

describe("renameJob et les référents d'un fichier inclus", () => {
  const referencing: Tree = {
    [GITLAB_CI_FILE]: [
      "include: ci/jobs.yml",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
    ].join("\n"),
    "ci/jobs.yml": [
      "sast:",
      "  stage: test",
      "  needs:",
      "    - compile",
      "  script:",
      "    - make scan",
      "",
    ].join("\n"),
  };

  test("le renommage est refusé et nomme chaque référent avec son fichier", () => {
    expect(
      expectRefusal(referencing, { kind: "renameJob", from: "compile", to: "build" }).params,
    ).toEqual({
      reason: "referencedByInclude",
      job: "compile",
      referencedBy: [{ job: "sast", file: "ci/jobs.yml" }],
    });
  });

  test("sans référent inclus, le renommage passe", () => {
    const alone: Tree = {
      ...referencing,
      "ci/jobs.yml": "autre:\n  stage: test\n  script:\n    - x\n",
    };
    const { result } = run(alone, { kind: "renameJob", from: "compile", to: "build" });
    expect(result.ok).toBe(true);
  });
});

describe("liste de stages venue d'un fichier inclus", () => {
  const stagesTree: Tree = {
    [GITLAB_CI_FILE]: [
      "include: ci/stages.yml",
      "",
      "travail:",
      "  stage: livrer",
      "  script:",
      "    - make",
      "",
    ].join("\n"),
    "ci/stages.yml": ["stages:", "  - preparer", "  - livrer", ""].join("\n"),
  };

  /** Le défaut que ce refus empêche est silencieux : `stagesSeq` ne trouve pas de liste dans le
   *  fichier principal, donc `planAddStage` en **matérialisait** une depuis les stages par défaut
   *  de GitLab. La liste de l'include disparaissait de l'écran sans qu'aucune erreur ne le dise. */
  test("addStage est refusé et nomme le fichier de la liste", () => {
    expect(expectRefusal(stagesTree, { kind: "addStage", name: "verifier" }).params).toEqual({
      reason: "stages",
      file: "ci/stages.yml",
    });
  });

  test("moveStage est refusé aussi", () => {
    expect(
      expectRefusal(stagesTree, { kind: "moveStage", name: "livrer", toIndex: 0 }).params,
    ).toEqual({ reason: "stages", file: "ci/stages.yml" });
  });

  test("ajouter un job dans un stage venu d'un include reste permis", () => {
    const { result } = run(stagesTree, {
      kind: "addJob",
      job: { id: "neuf", stage: "preparer", script: ["make"] },
    });
    expect(result.ok).toBe(true);
  });

  test("avec une liste dans le fichier principal, addStage passe", () => {
    const local: Tree = {
      ...stagesTree,
      [GITLAB_CI_FILE]: `stages:\n  - livrer\n\n${stagesTree[GITLAB_CI_FILE]}`,
    };
    const { result } = run(local, { kind: "addStage", name: "verifier" });
    expect(result.ok).toBe(true);
  });
});

describe("apply ne fait rien sortir du fichier principal", () => {
  /** Ce que ce bloc mesure, exactement : `apply` est une fonction **pure** — elle ne touche pas au
   *  disque — donc relire un fichier inclus après l'appel serait une tautologie. C'était la
   *  première version de ces tests, et la revue indépendante du 2026-10-23 l'a prouvée inerte en
   *  neutralisant tous les refus `FROM_INCLUDED_FILE` : les deux tests restaient verts.
   *
   *  Ce qui est mesurable ici est que le résultat ne prétend pas avoir changé un fichier inclus :
   *  `included` doit revenir identique, et chaque plage touchée doit tomber dans le texte du
   *  fichier principal. La garantie sur les **octets du disque** se mesure là où une écriture a
   *  lieu, c'est-à-dire dans `packages/server/test/includes.test.ts`. */
  test("les textes inclus reviennent identiques après une opération acceptée", () => {
    const { parsed, result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    if (!result.ok) {
      throw new Error(`opération refusée : ${result.error.code}`);
    }

    expect(result.value.included).toEqual(parsed.included);
    expect(result.value.included["ci/jobs.yml"]).toBe(TREE["ci/jobs.yml"]);
  });

  test("chaque plage touchée tombe dans le texte du fichier principal", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    if (!result.ok) {
      throw new Error("opération refusée");
    }

    for (const range of result.value.touched) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(result.value.text.length);
    }
  });

  test("le pipeline rendu après l'opération garde les jobs des fichiers inclus", () => {
    const { result } = run(TREE, {
      kind: "addJob",
      job: { id: "neuf", stage: "test", script: ["make"] },
    });
    if (!result.ok) {
      throw new Error("opération refusée");
    }
    // Sans le lecteur porté par le document, `apply` relirait le texte sans ses includes et
    // `compile` disparaîtrait de la réponse.
    expect(result.value.pipeline.jobs.map((job) => job.id).sort()).toEqual([
      "compile",
      "local-job",
      "neuf",
    ]);
  });
});
