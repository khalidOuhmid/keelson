import { describe, expect, test } from "bun:test";
import { coverage, loadCatalog } from "@keelson/catalog";
import { hashText, type Operation, type SpliceOperation } from "@keelson/core";
import { apply } from "../src/apply.ts";
import type { IncludeReader } from "../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../src/parse.ts";

const BASE = "stages:\n  - build\n  - test\n\ncompile:\n  stage: build\n  script:\n    - make\n";
const SNIPPET =
  'trivy:\n  stage: test\n  image:\n    name: aquasec/trivy:latest\n    entrypoint: [""]\n  script:\n    - trivy fs .\n';

type Draft = Record<string, unknown> & { kind: string };

function run(text: string, draft: Draft) {
  return apply(parse(text).document, { v: 1, baseHash: hashText(text), ...draft } as Operation);
}

function written(text: string, draft: Draft): string {
  const result = run(text, draft);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value.text;
}

const add = { kind: "addSnippet", id: "trivy", stage: "test", snippet: SNIPPET };

describe("addSnippet", () => {
  test("recopie le snippet tel quel en fin de fichier", () => {
    expect(written(BASE, add)).toBe(`${BASE}\n${SNIPPET}`);
  });

  test("la clé et le stage sont remplacés, le reste non", () => {
    const text = written(BASE, { ...add, id: "scan-fs", stage: "build" });
    expect(text).toContain("scan-fs:\n  stage: build\n  image:\n    name: aquasec/trivy:latest\n");
    expect(text).not.toContain("trivy:\n");
  });

  test("un snippet sans stage en reçoit un", () => {
    const text = written(BASE, { ...add, snippet: "x:\n  script:\n    - a\n" });
    const job = parse(text).pipeline.jobs.find((entry) => entry.id === "trivy");
    expect(job?.stage.value).toBe("test");
  });

  test("le fin de ligne du fichier s'applique au snippet", () => {
    const crlf = BASE.replaceAll("\n", "\r\n");
    expect(written(crlf, add)).not.toMatch(/[^\r]\n/);
  });

  test("un nom de job piégé reste une clé", () => {
    const text = written(BASE, { ...add, id: "scan: fs" });
    expect(parse(text).pipeline.jobs.map((job) => job.id)).toContain("scan: fs");
  });

  test.each([
    ["deux jobs", "a:\n  script: x\nb:\n  script: y\n"],
    ["une liste", "- a\n"],
    ["un scalaire", "bonjour\n"],
    ["du YAML cassé", "a: [\n"],
    ["une ancre", "a: &x\n  script: y\n"],
    ["un job vide", "a:\n"],
    ["une clé de premier niveau", "stages:\n  - a\n"],
    ["un job en flow", "a: {script: y}\n"],
  ])("%s est refusé", (_label, snippet) => {
    const result = run(BASE, { ...add, snippet });
    expect(result.ok ? null : result.error).toMatchObject({
      code: "INVALID_OPERATION",
      params: { reason: "invalidSnippet" },
    });
  });

  test.each([
    ["une clé indentée", "  x:\n    stage: test\n    script:\n      - a\n"],
    ["un commentaire indenté en tête", "    # note\nx:\n  script:\n    - a\n"],
    ["un stage vide commenté", "x:\n  stage: # c\n  script:\n    - a\n"],
    ["un stage vide tagué", "x:\n  stage: !!str\n  script:\n    - a\n"],
    ["un stage sans valeur", "x:\n  stage:\n  script:\n    - a\n"],
  ])("%s est refusé", (_label, snippet) => {
    expect(run(BASE, { ...add, snippet })).toMatchObject({
      error: { params: { reason: "invalidSnippet" } },
    });
  });

  test("un commentaire de tête à la colonne zéro est recopié", () => {
    expect(written(BASE, { ...add, snippet: `# scan\n${SNIPPET}` })).toContain("# scan\ntrivy:\n");
  });

  test("les refus de nom et de stage sont ceux d'addJob", () => {
    expect(run(BASE, { ...add, id: "compile" })).toMatchObject({
      error: { code: "NAME_CONFLICT" },
    });
    expect(run(BASE, { ...add, id: ".x" })).toMatchObject({ error: { code: "INVALID_NAME" } });
    expect(run(BASE, { ...add, stage: "deploy2" })).toMatchObject({
      error: { code: "STAGE_NOT_FOUND" },
    });
  });

  test("un nom pris dans un fichier inclus est refusé", () => {
    const files: Record<string, string> = { "ci/a.yml": "trivy:\n  script: x\n" };
    const read: IncludeReader = {
      read: (p) => files[p] ?? null,
      candidates: () => Object.keys(files),
    };
    const text = `include: /ci/a.yml\n${BASE}`;
    const document = parse(text, { file: GITLAB_CI_FILE, read }).document;
    const result = apply(document, { v: 1, baseHash: hashText(text), ...add } as Operation);
    expect(result.ok ? null : result.error.code).toBe("FROM_INCLUDED_FILE");
  });

  test("tout snippet GitLab du catalogue s'insère et couvre ses couches", () => {
    const { tools } = loadCatalog();
    const failures = tools.flatMap((tool) => {
      const snippet = tool.snippets.gitlab;
      if (snippet === null) {
        return [];
      }
      const result = run(BASE, { kind: "addSnippet", id: "added", stage: "test", snippet });
      if (!result.ok) {
        return [`${tool.id}: ${result.error.code}`];
      }
      const covered = coverage(result.value.pipeline, tools).jobs.find(
        (entry) => entry.job === "added",
      );
      return tool.layers.every((layer) => covered?.layers.includes(layer))
        ? []
        : [`${tool.id}: couches ${covered?.layers.join(",")}`];
    });
    expect(failures).toEqual([]);
  });
});

describe("composite", () => {
  const steps = [
    { kind: "addStage", name: "security" },
    { kind: "addSnippet", id: "trivy", stage: "security", snippet: SNIPPET },
  ];

  test("le stage et le job arrivent ensemble", () => {
    const text = written(BASE, { kind: "composite", steps });
    const { pipeline } = parse(text);
    expect(pipeline.stages.map((stage) => stage.name)).toContain("security");
    expect(pipeline.jobs.find((job) => job.id === "trivy")?.stage.value).toBe("security");
  });

  test("un seul inverse rend le texte d'origine, octet pour octet", () => {
    const result = run(BASE, { kind: "composite", steps });
    if (!result.ok) {
      throw new Error("refusé");
    }
    const { document } = parse(result.value.text);
    const back = apply(document, result.value.inverse as SpliceOperation);
    expect(back.ok && back.value.text).toBe(BASE);
  });

  test("une seule plage touchée, du premier au dernier octet changé", () => {
    const result = run(BASE, { kind: "composite", steps });
    expect(result.ok && result.value.touched).toHaveLength(1);
    const range = result.ok ? result.value.touched[0] : undefined;
    expect(result.ok && result.value.text.slice(0, range?.start)).toBe(BASE.slice(0, range?.start));
  });

  test("une étape refusée refuse tout", () => {
    const result = run(BASE, {
      kind: "composite",
      steps: [
        { kind: "addStage", name: "security" },
        { ...steps[1], id: "compile" },
      ],
    });
    expect(result.ok ? null : result.error.code).toBe("NAME_CONFLICT");
  });

  test("une composite ne contient ni splice ni autre composite", () => {
    const hash = hashText(BASE);
    for (const step of [
      { kind: "splice", start: 0, end: 0, text: "" },
      { kind: "composite", steps: [] },
      { kind: "removeJob", id: "compile" },
    ]) {
      const result = apply(parse(BASE).document, {
        v: 1,
        baseHash: hash,
        kind: "composite",
        steps: [step],
      } as Operation);
      expect(result.ok ? null : result.error.code).toBe("INVALID_OPERATION");
    }
  });

  test("une ancre sur le dernier stage n'est pas recopiée", () => {
    const text = "stages:\n  - build\n  - &t test\n\na:\n  stage: *t\n  script: x\n";
    const after = parse(written(text, { kind: "addStage", name: "scan" }));
    expect(after.pipeline.jobs[0]?.stage.value).toBe("test");
  });

  test.each([["- # c\n    test"], ["- &t\n    test"]])(
    "un item sur une ligne de continuation (%j) n'est pas prolongé",
    (item) => {
      const text = `stages:\n  - build\n  ${item}\n\na:\n  stage: test\n  script: x\n`;
      const after = parse(written(text, { kind: "addStage", name: "scan" }));
      expect(after.pipeline.stages.map((stage) => stage.name)).toEqual(
        expect.arrayContaining(["test", "scan"]),
      );
    },
  );

  test("une composite vide est refusée", () => {
    expect(run(BASE, { kind: "composite", steps: [] }).ok).toBe(false);
  });
});

describe("needs inter-projets", () => {
  const INCLUDED =
    ".base:\n  needs:\n    - a\n    - project: g/p\n      job: j\n      ref: main\n      artifacts: true\n";
  const MAIN = `a:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .base\n  stage: test\n  script: x\n\n${INCLUDED}`;

  test("surcharger des needs hérités qui en portent est refusé", () => {
    for (const draft of [
      { kind: "removeNeed", id: "job", job: "a" },
      { kind: "addNeed", id: "job", need: { job: "c" } },
    ]) {
      expect(run(MAIN, draft)).toMatchObject({
        error: { code: "INVALID_OPERATION", params: { reason: "sharedValue", key: "needs" } },
      });
    }
  });

  test("retirer le dernier need modélisé d'une liste locale ne retire pas la clé", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n    - a\n    - project: g/p\n      job: j\n      ref: main\n      artifacts: true\n";
    expect(run(text, { kind: "removeNeed", id: "job", job: "a" }).ok).toBe(false);
  });

  test("un item inter-projets derrière une ancre se voit aussi", () => {
    const anchor = ".p: &p\n  project: g/p\n  job: j\n  ref: main\n  artifacts: true\n\n";
    const jobs = "a:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n";
    for (const item of ["    - *p\n", "    - <<: *p\n"]) {
      const text = `${anchor}${jobs}    - a\n${item}`;
      expect(run(text, { kind: "removeNeed", id: "job", job: "a" }).ok).toBe(false);
    }
  });

  test.each([
    ["!reference dans la liste", "    - a\n    - !reference [.n, needs]\n"],
    ["liste imbriquée", "    - a\n    - - project: g/p\n        job: j\n        ref: main\n"],
  ])("un item inter-projets dans %s se voit aussi", (_label, items) => {
    const text = `.n:\n  needs:\n    - project: g/p\n      job: j\n      ref: main\n\n.tpl:\n  needs:\n${items}\na:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .tpl\n  stage: test\n  script: x\n`;
    expect(run(text, { kind: "addNeed", id: "job", need: { job: "c" } }).ok).toBe(false);
  });

  test("un item imbriqué ordinaire n'est pas perdu non plus", () => {
    const text = `.n:\n  needs:\n    - b\n\n.t:\n  needs:\n    - a\n    - !reference [.n, needs]\n\na:\n  stage: test\n  script: x\n\nb:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .t\n  stage: test\n  script: x\n`;
    expect(run(text, { kind: "addNeed", id: "job", need: { job: "c" } }).ok).toBe(false);
  });

  test("des références larges ne font pas exploser l'analyse", () => {
    const refs = "    - !reference [.n, needs]\n".repeat(30);
    const started = performance.now();
    parse(`.n:\n  needs:\n${refs}\na:\n  extends: .n\n  script: x\n`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test.each([
    ["alias de scalaire", "    - a\n    - *b\n"],
    ["map avec alias", "    - a\n    - job: *b\n"],
    ["clé non modélisée", "    - job: a\n      parallel:\n        matrix:\n          - X: 1\n"],
    ["optional en alias", "    - job: a\n      optional: *o\n"],
  ])("surcharger une liste héritée avec %s est refusé", (_label, items) => {
    const text = `.v:\n  x: &b a\n  y: &o true\n\n.t:\n  needs:\n${items}\na:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  extends: .t\n  stage: test\n  script: x\n`;
    expect(run(text, { kind: "addNeed", id: "job", need: { job: "c" } })).toMatchObject({
      error: { code: "INVALID_OPERATION" },
    });
  });

  test("retirer le dernier need local ne fait pas ressortir l'hérité", () => {
    const text =
      ".t:\n  needs:\n    - b\n\na:\n  stage: test\n  script: x\n\nb:\n  stage: test\n  script: x\n\njob:\n  extends: .t\n  stage: test\n  script: x\n  needs:\n    - a\n";
    const result = run(text, { kind: "removeNeed", id: "job", job: "a" });
    if (result.ok) {
      const job = parse(result.value.text).pipeline.jobs.find((entry) => entry.id === "job");
      expect(job?.needs?.value ?? []).toEqual([]);
    }
  });

  test("retirer un item porteur d'une ancre utilisée ne laisse pas d'alias pendant", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\nb:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n    - &k a\n    - b\n\nz:\n  stage: test\n  script: x\n  needs:\n    - *k\n";
    expect(run(text, { kind: "removeNeed", id: "job", job: "a" }).ok).toBe(false);
  });

  test("une chaîne d'ancres longue ne ralentit pas l'analyse", () => {
    const links = Array.from({ length: 400 }, (_, index) =>
      index === 0
        ? ".m0: &m0\n  x: 1\n"
        : `.m${index}: &m${index}\n  <<: [*m${index - 1}, *m${index - 1}]\n`,
    ).join("");
    const started = performance.now();
    parse(`${links}.t:\n  needs:\n    - *m399\n\njob:\n  extends: .t\n  script: x\n`);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  test("une liste locale s'étend sans perdre l'item", () => {
    const text =
      "a:\n  stage: test\n  script: x\n\nc:\n  stage: test\n  script: x\n\njob:\n  stage: test\n  script: x\n  needs:\n    - a\n    - project: g/p\n      job: j\n      ref: main\n      artifacts: true\n";
    expect(written(text, { kind: "addNeed", id: "job", need: { job: "c" } })).toContain(
      "project: g/p",
    );
  });
});
