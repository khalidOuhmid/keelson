import { describe, expect, test } from "bun:test";
import { hashText, type Operation, type SpliceOperation } from "@keelson/core";
import { apply, parse } from "../src/index.ts";

const FILE = ".github/workflows/ci.yml";

const BASE = `# le CI
name: CI
on: [push]

jobs:
  # compile tout
  build:
    runs-on: ubuntu-latest # vite
    steps:
      - run: make

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: make check

  deploy:
    needs: [build, test]
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy
`;

type Draft = Record<string, unknown> & { kind: string };

function run(text: string, draft: Draft) {
  return apply(parse(text, { file: FILE }).document, {
    v: 1,
    baseHash: hashText(text),
    ...draft,
  } as Operation);
}

function written(text: string, draft: Draft): string {
  const result = run(text, draft);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value.text;
}

const jobOf = (text: string, id: string) =>
  parse(text, { file: FILE }).pipeline.jobs.find((job) => job.id === id);

const needsOf = (text: string, id: string) => jobOf(text, id)?.needs?.value.map((n) => n.job);

const newJob = { id: "lint", stage: "", script: ["make lint"] };

describe("addJob", () => {
  test("en fin de jobs, à l'indentation trouvée, le reste intact", () => {
    const text = written(BASE, { kind: "addJob", job: newJob });
    expect(text).toContain(
      "      - run: ./deploy\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make lint\n",
    );
    expect(text.startsWith(BASE)).toBe(true);
  });

  test("avec needs et environnement", () => {
    const text = written(BASE, {
      kind: "addJob",
      job: {
        ...newJob,
        needs: [{ job: "build" }],
        environment: { name: "prod", url: "https://u" },
      },
    });
    expect(needsOf(text, "lint")).toEqual(["build"]);
    expect(jobOf(text, "lint")?.environment?.value).toEqual({ name: "prod", url: "https://u" });
  });

  test("crée jobs: s'il manque", () => {
    const text = written("name: x\non: push\n", { kind: "addJob", job: newJob });
    expect(jobOf(text, "lint")).toBeDefined();
  });

  test("refus : nom pris, nom illégal", () => {
    expect(run(BASE, { kind: "addJob", job: { ...newJob, id: "build" } })).toMatchObject({
      error: { code: "NAME_CONFLICT" },
    });
    expect(run(BASE, { kind: "addJob", job: { ...newJob, id: "a b" } })).toMatchObject({
      error: { code: "INVALID_NAME" },
    });
    expect(run(BASE, { kind: "addJob", job: { ...newJob, script: [] } })).toMatchObject({
      error: { params: { reason: "jobWithoutScript" } },
    });
  });

  test("un script multiligne ou piégé reste une valeur", () => {
    const text = written(BASE, { kind: "addJob", job: { ...newJob, script: ["a: b #c", "x\ny"] } });
    expect(jobOf(text, "lint")?.signals.script).toEqual(["a: b #c", "x\ny"]);
  });
});

describe("addSnippet", () => {
  const snippet = "- name: Scan\n  run: trivy fs .\n";

  test("un job avec checkout puis les étapes de la fiche", () => {
    const text = written(BASE, { kind: "addSnippet", id: "trivy", stage: "", snippet });
    const job = jobOf(text, "trivy");
    expect(job?.signals.script).toEqual(["trivy fs ."]);
    expect(job?.signals.actions?.[0]).toStartWith("actions/checkout@");
    expect(text).toContain("      - name: Scan\n        run: trivy fs .\n");
  });

  test.each([
    ["une map", "a: b\n"],
    ["une liste vide", "[]\n"],
    ["une liste de scalaires", "- a\n"],
    ["du YAML cassé", "- [\n"],
    ["une ancre", "- &a\n  run: x\n"],
    ["un commentaire indenté", "    # x\n- run: x\n"],
  ])("%s est refusé", (_label, bad) => {
    expect(run(BASE, { kind: "addSnippet", id: "x", stage: "", snippet: bad })).toMatchObject({
      error: { params: { reason: "invalidSnippet" } },
    });
  });
});

describe("removeJob et renameJob", () => {
  test("retirer garde le commentaire du voisin", () => {
    const text = written(BASE, { kind: "removeJob", id: "deploy" });
    expect(jobOf(text, "deploy")).toBeUndefined();
    expect(text).toContain("make check");
  });

  test("retirer un job dont d'autres ont besoin est refusé", () => {
    expect(run(BASE, { kind: "removeJob", id: "build" })).toMatchObject({
      error: { code: "JOB_REFERENCED", params: { referencedBy: ["test", "deploy"] } },
    });
  });

  test("renommer suit needs, en scalaire et en flow", () => {
    const text = written(BASE, { kind: "renameJob", from: "build", to: "compile" });
    expect(needsOf(text, "test")).toEqual(["compile"]);
    expect(needsOf(text, "deploy")).toEqual(["compile", "test"]);
    expect(text).toContain("# compile tout\n  compile:\n    runs-on: ubuntu-latest # vite\n");
  });

  test("refus : introuvable, nom pris", () => {
    expect(run(BASE, { kind: "removeJob", id: "x" })).toMatchObject({
      error: { code: "JOB_NOT_FOUND" },
    });
    expect(run(BASE, { kind: "renameJob", from: "build", to: "test" })).toMatchObject({
      error: { code: "NAME_CONFLICT" },
    });
  });
});

describe("needs", () => {
  test("ajouter à un scalaire, à une liste flow, à une liste en bloc, à rien", () => {
    expect(
      needsOf(written(BASE, { kind: "addNeed", id: "test", need: { job: "deploy2" } }), "test"),
    ).toEqual(["build", "deploy2"]);
    expect(
      needsOf(written(BASE, { kind: "addNeed", id: "deploy", need: { job: "z" } }), "deploy"),
    ).toEqual(["build", "test", "z"]);
    expect(
      needsOf(written(BASE, { kind: "addNeed", id: "build", need: { job: "z" } }), "build"),
    ).toEqual(["z"]);
    const block =
      "jobs:\n  a:\n    needs:\n      - b # c\n    steps:\n      - run: x\n  b:\n    steps:\n      - run: x\n  z:\n    steps:\n      - run: x\n";
    const text = written(block, { kind: "addNeed", id: "a", need: { job: "z" } });
    expect(text).toContain("      - b # c\n      - z\n");
  });

  test("retirer d'un scalaire enlève la clé, d'une liste garde le reste", () => {
    expect(
      jobOf(written(BASE, { kind: "removeNeed", id: "test", job: "build" }), "test")?.needs,
    ).toBeNull();
    expect(
      needsOf(written(BASE, { kind: "removeNeed", id: "deploy", job: "build" }), "deploy"),
    ).toEqual(["test"]);
  });

  test("refus : déjà là, absent, cycle, options", () => {
    expect(run(BASE, { kind: "addNeed", id: "test", need: { job: "build" } })).toMatchObject({
      error: { code: "NEED_EXISTS" },
    });
    expect(run(BASE, { kind: "removeNeed", id: "build", job: "x" })).toMatchObject({
      error: { code: "NEED_NOT_FOUND" },
    });
    expect(run(BASE, { kind: "addNeed", id: "build", need: { job: "deploy" } })).toMatchObject({
      error: { code: "CYCLE" },
    });
    expect(
      run(BASE, { kind: "addNeed", id: "build", need: { job: "z", optional: true } }),
    ).toMatchObject({
      error: { params: { reason: "notForProvider" } },
    });
  });
});

describe("environnement", () => {
  test("ajouter, remplacer, retirer", () => {
    const added = written(BASE, {
      kind: "setEnvironment",
      id: "build",
      environment: { name: "prod" },
    });
    expect(jobOf(added, "build")?.environment?.value).toEqual({ name: "prod" });
    const replaced = written(added, {
      kind: "setEnvironment",
      id: "build",
      environment: { name: "s", url: "https://u" },
    });
    expect(jobOf(replaced, "build")?.environment?.value).toEqual({ name: "s", url: "https://u" });
    const removed = written(replaced, { kind: "setEnvironment", id: "build", environment: null });
    expect(jobOf(removed, "build")?.environment).toBeNull();
    expect(removed).toBe(BASE);
  });

  test("action n'existe pas ici", () => {
    expect(
      run(BASE, {
        kind: "setEnvironment",
        id: "build",
        environment: { name: "p", action: "stop" },
      }),
    ).toMatchObject({
      error: { params: { reason: "notForProvider" } },
    });
  });
});

describe("ce qui n'a pas de sens ici", () => {
  test.each([
    [{ kind: "addStage", name: "x" }],
    [{ kind: "moveStage", name: "x", toIndex: 0 }],
    [{ kind: "setJobStage", id: "build", stage: "x" }],
  ])("%j est refusé", (draft) => {
    expect(run(BASE, draft)).toMatchObject({ error: { params: { reason: "notForProvider" } } });
  });
});

describe("garde-fous", () => {
  test("un hash périmé", () => {
    const result = apply(parse(BASE, { file: FILE }).document, {
      v: 1,
      baseHash: "a".repeat(64),
      kind: "removeJob",
      id: "deploy",
    });
    expect(result.ok ? null : result.error.code).toBe("STALE_DOCUMENT");
  });

  test("une section en flow n'est pas réécrite", () => {
    expect(run("jobs: {a: {steps: [{run: x}]}}\n", { kind: "addJob", job: newJob })).toMatchObject({
      error: { code: "INVALID_OPERATION" },
    });
  });

  test("une forme que le patch ne sait pas écrire est refusée, pas écrite", () => {
    const text = "jobs:\n  a: &a\n    steps:\n      - run: x\n  b: *a\n";
    expect(run(text, { kind: "addNeed", id: "a", need: { job: "z" } }).ok).toBe(false);
    expect(run(text, { kind: "removeJob", id: "a" }).ok).toBe(false);
  });

  test("un doublon que le patch ne retirerait qu'à moitié est refusé à la relecture", () => {
    const text = "jobs:\n  a:\n    needs:\n      - b\n      - b\n      - c\n    steps:\n      - run: x\n";
    expect(run(text, { kind: "removeNeed", id: "a", job: "b" })).toMatchObject({
      error: { params: { reason: "wouldBreakYaml" } },
    });
  });

  test("un job en valeur de bloc en dernière position garde son voisin", () => {
    const text =
      "jobs:\n  a:\n    steps:\n      - run: |\n          x\n  b:\n    steps:\n      - run: y\n";
    expect(jobOf(written(text, { kind: "removeJob", id: "a" }), "b")).toBeDefined();
  });
});

describe("composite et inverse", () => {
  test("une composite s'annule d'un seul splice", () => {
    const result = run(BASE, {
      kind: "composite",
      steps: [
        { kind: "addJob", job: newJob },
        { kind: "addNeed", id: "lint", need: { job: "build" } },
      ],
    });
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    expect(result.value.touched).toHaveLength(1);
    const back = apply(
      parse(result.value.text, { file: FILE }).document,
      result.value.inverse as SpliceOperation,
    );
    expect(back.ok && back.value.text).toBe(BASE);
  });

  test("une étape refusée refuse tout", () => {
    expect(
      run(BASE, {
        kind: "composite",
        steps: [
          { kind: "addJob", job: newJob },
          { kind: "addStage", name: "x" },
        ],
      }).ok,
    ).toBe(false);
  });

  test("un splice hors du texte est refusé", () => {
    expect(run(BASE, { kind: "splice", start: 0, end: 1e6, text: "" })).toMatchObject({
      error: { code: "RANGE_OUT_OF_BOUNDS" },
    });
  });
});
