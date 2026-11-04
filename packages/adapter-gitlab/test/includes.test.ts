import { describe, expect, test } from "bun:test";
import {
  EXTENDS_TARGET_NOT_FOUND,
  INCLUDE_CYCLE,
  INCLUDE_LIMIT_EXCEEDED,
  INCLUDE_NOT_FOUND,
  INCLUDE_UNRESOLVED,
  isPartial,
} from "@keelson/core";
import {
  type IncludeReader,
  MAX_INCLUDED_FILES,
  matchesWildcard,
  normaliseIncludePath,
} from "../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../src/parse.ts";

/** Un dépôt littéral. Tout le module se teste ainsi : aucune écriture sur disque, donc aucun test
 *  qui passe parce qu'un fichier traîne. */
function reader(files: Record<string, string>): IncludeReader {
  return {
    read: (path) => files[path] ?? null,
    candidates: () => Object.keys(files),
  };
}

function parseTree(files: Record<string, string>, main = GITLAB_CI_FILE) {
  const text = files[main];
  if (text === undefined) {
    throw new Error(`l'arbre n'a pas de ${main}`);
  }
  return parse(text, { file: main, read: reader(files) });
}

function codes(files: Record<string, string>): string[] {
  return parseTree(files).diagnostics.map((diagnostic) => diagnostic.code);
}

function jobIds(files: Record<string, string>): string[] {
  return parseTree(files).pipeline.jobs.map((job) => job.id);
}

const JOB = (id: string, stage: string): string =>
  [`${id}:`, `  stage: ${stage}`, "  script:", "    - make", ""].join("\n");

describe("normalisation des chemins d'include", () => {
  test("le / de tête est optionnel : GitLab compte depuis la racine du dépôt", () => {
    expect(normaliseIncludePath("/ci/jobs.yml")).toEqual({ ok: true, path: "ci/jobs.yml" });
    expect(normaliseIncludePath("ci/jobs.yml")).toEqual({ ok: true, path: "ci/jobs.yml" });
  });

  test("les segments vides et « . » sont réduits", () => {
    expect(normaliseIncludePath("//ci//./jobs.yml")).toEqual({ ok: true, path: "ci/jobs.yml" });
  });

  test("un chemin qui sort de la racine est refusé avant toute lecture", () => {
    expect(normaliseIncludePath("../../etc/passwd")).toEqual({
      ok: false,
      reason: "outsideRoot",
      path: "../../etc/passwd",
    });
    expect(normaliseIncludePath("ci/../../secret.yml")).toEqual({
      ok: false,
      reason: "outsideRoot",
      path: "ci/../../secret.yml",
    });
  });

  test("un antislash ne contourne pas le contrôle", () => {
    expect(normaliseIncludePath("..\\..\\etc\\passwd.yml")).toEqual({
      ok: false,
      reason: "outsideRoot",
      path: "..\\..\\etc\\passwd.yml",
    });
  });

  test("GitLab exige .yml ou .yaml", () => {
    expect(normaliseIncludePath("ci/jobs.yaml").ok).toBe(true);
    expect(normaliseIncludePath("ci/jobs.txt")).toEqual({
      ok: false,
      reason: "notYaml",
      path: "ci/jobs.txt",
    });
  });

  test("un chemin vide est refusé", () => {
    expect(normaliseIncludePath("/").ok).toBe(false);
  });
});

describe("jokers", () => {
  /** Les trois exemples de la documentation GitLab, dans les deux sens : ce qui correspond et ce
   *  qui ne correspond pas. Sans la seconde moitié, un motif traduit en `.*` passerait partout. */
  test("* ne traverse pas un séparateur", () => {
    expect(matchesWildcard("configs/*.yml", "configs/a.yml")).toBe(true);
    expect(matchesWildcard("configs/*.yml", "configs/sous/a.yml")).toBe(false);
  });

  test("** traverse les séparateurs, y compris zéro", () => {
    expect(matchesWildcard("configs/**.yml", "configs/a.yml")).toBe(true);
    expect(matchesWildcard("configs/**.yml", "configs/sous/a.yml")).toBe(true);
    expect(matchesWildcard("configs/**.yml", "autre/a.yml")).toBe(false);
  });

  test("**/ * .yml ne prend que les sous-dossiers", () => {
    expect(matchesWildcard("configs/**/*.yml", "configs/sous/a.yml")).toBe(true);
    expect(matchesWildcard("configs/**/*.yml", "configs/a.yml")).toBe(false);
  });

  test("le point d'un motif est un point littéral, pas un joker de regex", () => {
    expect(matchesWildcard("ci/jobs.yml", "ci/jobsXyml")).toBe(false);
  });
});

describe("résolution", () => {
  test("un include local simple apporte ses jobs", () => {
    expect(
      jobIds({
        [GITLAB_CI_FILE]: ["include: ci/jobs.yml", "", "stages:", "  - build", ""].join("\n"),
        "ci/jobs.yml": JOB("compile", "build"),
      }),
    ).toEqual(["compile"]);
  });

  test("un include imbriqué est résolu récursivement", () => {
    expect(
      jobIds({
        [GITLAB_CI_FILE]: "include: ci/a.yml\n",
        "ci/a.yml": `include: ci/b.yml\n\n${JOB("depuis-a", "build")}`,
        "ci/b.yml": JOB("depuis-b", "build"),
      }),
    ).toEqual(["depuis-b", "depuis-a"]);
  });

  test("une liste mêlant les formes résout les locales et signale les distantes", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - ci/a.yml",
        "  - local: /ci/b.yml",
        "  - template: Jobs/SAST.gitlab-ci.yml",
        "  - remote: https://exemple/ci.yml",
        "",
      ].join("\n"),
      "ci/a.yml": JOB("a", "build"),
      "ci/b.yml": JOB("b", "build"),
    });

    expect(parsed.pipeline.jobs.map((job) => job.id)).toEqual(["a", "b"]);
    expect(parsed.pipeline.unresolved.map((entry) => entry.form)).toEqual(["template", "remote"]);
    expect(isPartial(parsed.pipeline)).toBe(true);
  });

  test("un pipeline dont tous les includes sont résolus n'est pas partiel", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": JOB("a", "build"),
    });
    expect(isPartial(parsed.pipeline)).toBe(false);
    expect(parsed.pipeline.unresolved).toEqual([]);
  });

  test("le fichier principal vient en dernier dans l'ordre de fusion", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": `include: ci/b.yml\n`,
      "ci/b.yml": "",
    });
    expect(parsed.pipeline.files).toEqual(["ci/b.yml", "ci/a.yml", GITLAB_CI_FILE]);
  });

  test("un fichier inclus deux fois entre deux fois : GitLab ne dédoublonne pas", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - ci/a.yml", "  - ci/a.yml", ""].join("\n"),
      "ci/a.yml": JOB("a", "build"),
    });
    expect(parsed.pipeline.files).toEqual(["ci/a.yml", "ci/a.yml", GITLAB_CI_FILE]);
    expect(parsed.pipeline.jobs.map((job) => job.id)).toEqual(["a"]);
  });

  test("un cycle est signalé et la résolution aboutit", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": "include: .gitlab-ci.yml\n",
    });

    const cycle = parsed.diagnostics.find((entry) => entry.code === INCLUDE_CYCLE);
    expect(cycle?.params).toEqual({ trail: [GITLAB_CI_FILE, "ci/a.yml", GITLAB_CI_FILE] });
    expect(cycle?.file).toBe("ci/a.yml");
  });

  test("un fichier absent est signalé avec son chemin normalisé", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: "include: /ci/absent.yml\n" });
    const found = parsed.diagnostics.find((entry) => entry.code === INCLUDE_NOT_FOUND);
    expect(found?.params).toEqual({ reason: "missing", path: "ci/absent.yml" });
    expect(found?.severity).toBe("error");
  });

  test("une entrée d'include illisible est signalée et n'arrête pas les autres", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - 42", "  - ci/a.yml", ""].join("\n"),
      "ci/a.yml": JOB("a", "build"),
    });
    expect(parsed.diagnostics.find((entry) => entry.code === INCLUDE_NOT_FOUND)?.params).toEqual({
      reason: "malformed",
    });
    expect(parsed.pipeline.jobs.map((job) => job.id)).toEqual(["a"]);
  });

  test("un joker prend les fichiers dans l'ordre lexicographique", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: configs/*.yml\n",
      "configs/c.yml": JOB("c", "build"),
      "configs/a.yml": JOB("a", "build"),
      "configs/b.yml": JOB("b", "build"),
      "configs/sous/z.yml": JOB("z", "build"),
    });
    // `configs/sous/z.yml` est exclu : `*` ne traverse pas un séparateur.
    expect(parsed.pipeline.files).toEqual([
      "configs/a.yml",
      "configs/b.yml",
      "configs/c.yml",
      GITLAB_CI_FILE,
    ]);
  });

  test("la limite de fichiers inclus arrête la résolution", () => {
    const files: Record<string, string> = {
      [GITLAB_CI_FILE]: "include: ci/f0.yml\n",
    };
    const total = MAX_INCLUDED_FILES + 5;
    for (let index = 0; index < total; index += 1) {
      const next = index + 1 < total ? `include: ci/f${index + 1}.yml\n\n` : "";
      files[`ci/f${index}.yml`] = `${next}${JOB(`j${index}`, "build")}`;
    }

    const parsed = parse(files[GITLAB_CI_FILE] ?? "", {
      file: GITLAB_CI_FILE,
      read: reader(files),
    });
    expect(
      parsed.diagnostics.filter((entry) => entry.code === INCLUDE_LIMIT_EXCEEDED),
    ).toHaveLength(1);
    // Le fichier principal est toujours dans la liste : la limite borne les inclus, pas lui.
    expect(parsed.pipeline.files.length).toBe(MAX_INCLUDED_FILES + 1);
  });

  test("sans lecteur, un include local est non résolu et non introuvable", () => {
    const text = "include: ci/jobs.yml\n";
    const parsed = parse(text, { file: GITLAB_CI_FILE });

    expect(parsed.pipeline.unresolved).toEqual([
      { form: "local", detail: "ci/jobs.yml", from: GITLAB_CI_FILE, range: { start: 9, end: 20 } },
    ]);
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([INCLUDE_UNRESOLVED]);
  });
});

describe("fusion des définitions", () => {
  test("le fichier principal surcharge un job venu d'un include", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        "compile:",
        "  stage: test",
        "",
      ].join("\n"),
      "ci/jobs.yml": JOB("compile", "build"),
    });

    const compile = parsed.pipeline.jobs.find((job) => job.id === "compile");
    expect(compile?.stage.value).toBe("test");
    // Surchargé dans le principal, donc le principal le possède, donc il reste éditable.
    expect(compile?.file).toBe(GITLAB_CI_FILE);
    // Le `script` vient toujours de l'include : rien n'est perdu par la surcharge.
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([]);
  });

  test("un job qui n'est que dans un include appartient à ce fichier", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include: ci/jobs.yml", "", "stages:", "  - build", ""].join("\n"),
      "ci/jobs.yml": JOB("compile", "build"),
    });
    expect(parsed.pipeline.jobs[0]?.file).toBe("ci/jobs.yml");
  });

  test("entre deux includes, le dernier gagne", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - ci/a.yml",
        "  - ci/b.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
      ].join("\n"),
      "ci/a.yml": JOB("compile", "build"),
      "ci/b.yml": JOB("compile", "test"),
    });

    const compile = parsed.pipeline.jobs[0];
    expect(compile?.stage.value).toBe("test");
    expect(compile?.file).toBe("ci/b.yml");
  });

  test("la valeur héritée d'un include porte son fichier dans son origine", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "",
        "compile:",
        "  script:",
        "    - make autre",
        "",
      ].join("\n"),
      "ci/jobs.yml": JOB("compile", "build"),
    });

    expect(parsed.pipeline.jobs[0]?.stage.origin).toEqual({
      kind: "include",
      file: "ci/jobs.yml",
    });
  });

  test("une liste stages déclarée dans un include est utilisée telle quelle", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/stages.yml\n",
      "ci/stages.yml": ["stages:", "  - preparer", "  - livrer", ""].join("\n"),
    });

    expect(parsed.pipeline.stages.map((stage) => stage.name)).toEqual(["preparer", "livrer"]);
    expect(parsed.pipeline.stages.every((stage) => stage.file === "ci/stages.yml")).toBe(true);
  });

  test("une liste stages du fichier principal écrase celle de l'include, elle ne s'y ajoute pas", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include: ci/stages.yml", "", "stages:", "  - unique", ""].join("\n"),
      "ci/stages.yml": ["stages:", "  - preparer", "  - livrer", ""].join("\n"),
    });
    expect(parsed.pipeline.stages.map((stage) => stage.name)).toEqual(["unique"]);
  });

  test("un extends traverse les fichiers", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/templates.yml",
        "",
        "stages:",
        "  - build",
        "",
        "compile:",
        "  extends: .base",
        "  script:",
        "    - make",
        "",
      ].join("\n"),
      "ci/templates.yml": [".base:", "  stage: build", ""].join("\n"),
    });

    expect(parsed.diagnostics.filter((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)).toEqual(
      [],
    );
    expect(parsed.pipeline.jobs[0]?.stage).toEqual({
      value: "build",
      origin: { kind: "include", file: "ci/templates.yml" },
    });
    expect(parsed.pipeline.templates[0]).toMatchObject({
      id: ".base",
      file: "ci/templates.yml",
    });
  });
});

describe("sévérité d'EXTENDS_TARGET_NOT_FOUND", () => {
  const MAIN_WITH_ORPHAN = [
    "stages:",
    "  - build",
    "",
    "orphelin:",
    "  extends: .absent",
    "  script:",
    "    - make",
    "",
  ].join("\n");

  /** C'est l'écart du 2026-10-20 : la cible manquante était dégradée en avertissement dès qu'une
   *  clé `include` existait, ce qui masquait de vraies erreurs. La dégradation suit désormais les
   *  includes **non résolus**, pas la présence de la clé. */
  test("tous les includes résolus : l'erreur retrouve sa sévérité", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: `include: ci/vide.yml\n\n${MAIN_WITH_ORPHAN}`,
      "ci/vide.yml": "variables:\n  A: 1\n",
    });

    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("error");
  });

  test("un include distant non résolu peut expliquer l'absence : avertissement", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: `include:\n  - template: Jobs/SAST.gitlab-ci.yml\n\n${MAIN_WITH_ORPHAN}`,
    });

    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("warning");
  });

  test("aucun include du tout : erreur, comme avant ce lot", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: MAIN_WITH_ORPHAN });
    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("error");
  });
});

describe("diagnostics attribués au bon fichier", () => {
  test("un job sans script dans un include est reproché à l'include", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include: ci/jobs.yml", "", "stages:", "  - build", ""].join("\n"),
      "ci/jobs.yml": ["muet:", "  stage: build", ""].join("\n"),
    });

    const found = parsed.diagnostics.find((entry) => entry.code === "JOB_WITHOUT_SCRIPT");
    expect(found?.file).toBe("ci/jobs.yml");

    /* La plage est un offset dans le texte de **ce** fichier, et l'assertion le **découpe**. La
       première version écrivait `expect(range ? "muet:" : "").toBe("muet:")` : un ternaire qui
       rendait la chaîne littérale attendue dès que la plage existait, donc elle ne lisait aucun
       octet et son commentaire surestimait tout ce qu'elle protégeait. Trouvée par la revue
       indépendante du 2026-10-23, qui l'a mise en défaut avec une plage absurde. */
    const range = found?.range;
    if (range === null || range === undefined) {
      throw new Error("JOB_WITHOUT_SCRIPT sans plage");
    }
    const included = parsed.pipeline.files.includes("ci/jobs.yml") ? "muet:\n  stage: build\n" : "";
    expect(included.slice(range.start, range.end)).toStartWith("muet:");
  });

  test("un YAML invalide dans un include est signalé avec son fichier", () => {
    expect(
      codes({
        [GITLAB_CI_FILE]: "include: ci/casse.yml\n",
        "ci/casse.yml": "a:\n  - x\n bad: [1,\n",
      }),
    ).toContain("INVALID_YAML");

    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/casse.yml\n",
      "ci/casse.yml": "a:\n  - x\n bad: [1,\n",
    });
    expect(
      parsed.diagnostics
        .filter((entry) => entry.code === "INVALID_YAML")
        .every((entry) => entry.file === "ci/casse.yml"),
    ).toBe(true);
  });
});

describe("un include local cassé rend le pipeline partiel", () => {
  /** Trouvé par la passe `critique` du 2026-10-23, sur le golden du lot lui-même : l'arbre
   *  `missing` rendait `jobs: []` et `unresolved: []`, donc `isPartial()` était **faux** sur le
   *  défaut le plus courant d'un dépôt réel — une faute de frappe dans un chemin d'include. La
   *  bande de pipeline partiel ne s'affichait pas, et l'écran laissait croire le pipeline complet
   *  alors qu'il lui manquait tout ce que ce fichier apportait. */
  const BROKEN = {
    [GITLAB_CI_FILE]: ["include: /ci/absent.yml", "", "stages:", "  - build", ""].join("\n"),
  };

  test("un chemin absent rend le pipeline partiel", () => {
    const parsed = parseTree(BROKEN);
    expect(isPartial(parsed.pipeline)).toBe(true);
    expect(parsed.pipeline.unresolved).toEqual([
      {
        form: "local",
        detail: "ci/absent.yml",
        from: GITLAB_CI_FILE,
        range: { start: 9, end: 23 },
      },
    ]);
  });

  test("l'erreur n'est pas redite en info : un seul diagnostic par include cassé", () => {
    expect(codes(BROKEN)).toEqual([INCLUDE_NOT_FOUND]);
  });

  test("les trois formes d'échec comptent toutes", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - /ci/absent.yml",
        "  - /ci/jobs.txt",
        "  - /../dehors.yml",
        "  - 42",
        "",
      ].join("\n"),
    });

    expect(parsed.pipeline.unresolved).toHaveLength(4);
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([
      INCLUDE_NOT_FOUND,
      INCLUDE_NOT_FOUND,
      INCLUDE_NOT_FOUND,
      INCLUDE_NOT_FOUND,
    ]);
  });

  test("une entrée illisible garde sa valeur écrite, et aucune phrase de l'adaptateur", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - 42", ""].join("\n"),
    });
    expect(parsed.pipeline.unresolved.map((entry) => entry.detail)).toEqual(["42"]);
  });

  test("un include résolu ne compte pas, même à côté d'un cassé", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - /ci/bon.yml", "  - /ci/absent.yml", ""].join("\n"),
      "ci/bon.yml": JOB("a", "build"),
    });
    expect(parsed.pipeline.unresolved.map((entry) => entry.detail)).toEqual(["ci/absent.yml"]);
    expect(parsed.pipeline.jobs.map((entry) => entry.id)).toEqual(["a"]);
  });

  /** Le cycle et la limite s'arrêtent **après** avoir lu le fichier : le pipeline a bien reçu son
   *  contenu, donc ils ne rendent pas le pipeline partiel. C'est la distinction que `failed` fait,
   *  et la mesurer évite de transformer `isPartial` en « il y a eu un problème quelque part ». */
  test("un cycle ne rend pas le pipeline partiel : le contenu a bien été lu", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": `include: .gitlab-ci.yml\n\n${JOB("a", "build")}`,
    });
    expect(parsed.diagnostics.map((entry) => entry.code)).toContain(INCLUDE_CYCLE);
    expect(isPartial(parsed.pipeline)).toBe(false);
    expect(parsed.pipeline.jobs.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("précédence entre extends et définitions inter-fichiers", () => {
  /** Trouvé par la revue indépendante du 2026-10-23. GitLab fusionne les includes puis le fichier
   *  principal, et ne résout `extends` qu'ensuite, sur le job fusionné : les clés propres d'un job
   *  battent toujours ses templates. Keelson faisait l'inverse, parce que les sources du template
   *  du fichier principal arrivaient après la map de l'include — et la vue Pipeline plaçait donc le
   *  job dans la mauvaise colonne. */
  test("une valeur écrite dans l'include bat un extends écrit dans le fichier principal", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        ".base:",
        "  stage: test",
        "",
        "compile:",
        "  extends: .base",
        "",
      ].join("\n"),
      "ci/jobs.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });

    expect(parsed.pipeline.jobs[0]?.stage).toEqual({
      value: "build",
      origin: { kind: "include", file: "ci/jobs.yml" },
    });
  });

  test("un extends apporte ce que le job ne déclare nulle part", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        ".base:",
        "  environment:",
        "    name: production",
        "",
        "compile:",
        "  extends: .base",
        "",
      ].join("\n"),
      "ci/jobs.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });

    expect(parsed.pipeline.jobs[0]?.environment?.value.name).toBe("production");
    expect(parsed.pipeline.jobs[0]?.stage.value).toBe("build");
  });

  test("les extends des deux fichiers s'additionnent sans doublon", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "",
        ".du-principal:",
        "  script:",
        "    - make",
        "",
        "compile:",
        "  extends:",
        "    - .du-principal",
        "    - .de-l-include",
        "",
      ].join("\n"),
      "ci/jobs.yml": [
        ".de-l-include:",
        "  stage: build",
        "",
        "compile:",
        "  extends: .de-l-include",
        "",
      ].join("\n"),
    });

    expect(parsed.pipeline.jobs[0]?.extends).toEqual([".de-l-include", ".du-principal"]);
  });
});

describe("blocs opaques d'un job surchargé", () => {
  /** Le défaut que la revue a trouvé **sur le golden du lot lui-même** : les blocs opaques étaient
   *  pris sur la seule définition propriétaire, donc un job défini dans un include et surchargé
   *  dans le fichier principal perdait à l'écran son `script` et ses `artifacts`. Le golden
   *  `override` figeait `"opaque": []`.
   *
   *  Pire que le défaut : le correctif existait, et l'une de mes restaurations de fichier pendant
   *  une vérification rouge l'a détruit sans bruit. La régénération des goldens a ensuite béni la
   *  régression. C'est pourquoi ce test lit les **clés et les fichiers**, pas un compte. */
  test("les blocs opaques viennent de toutes les définitions, chacun avec son fichier", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        "compile:",
        "  stage: test",
        "  rules:",
        "    - when: manual",
        "",
      ].join("\n"),
      "ci/jobs.yml": [
        "compile:",
        "  stage: build",
        "  script:",
        "    - make",
        "  artifacts:",
        "    paths:",
        "      - build/",
        "",
      ].join("\n"),
    });

    const compile = parsed.pipeline.jobs[0];
    expect(compile?.file).toBe(GITLAB_CI_FILE);
    expect(compile?.opaque.map((block) => [block.key, block.file])).toEqual([
      ["script", "ci/jobs.yml"],
      ["artifacts", "ci/jobs.yml"],
      ["rules", GITLAB_CI_FILE],
    ]);
  });

  test("une clé redéfinie ne garde que la dernière, avec le fichier qui gagne", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "",
        "compile:",
        "  script:",
        "    - make autre",
        "",
      ].join("\n"),
      "ci/jobs.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });

    expect(parsed.pipeline.jobs[0]?.opaque.map((block) => [block.key, block.file])).toEqual([
      ["script", GITLAB_CI_FILE],
    ]);
  });
});
