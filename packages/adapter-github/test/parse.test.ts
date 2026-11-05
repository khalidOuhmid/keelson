import { describe, expect, test } from "bun:test";
import { isPartial } from "@keelson/core";
import { parse } from "../src/index.ts";

const FILE = ".github/workflows/ci.yml";

const WORKFLOW = `name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make
  test:
    needs: build
    runs-on: ubuntu-latest
    container: aquasec/trivy:0.50
    steps:
      - run: |
          trivy fs .
          echo ok
  deploy:
    needs: [build, test]
    environment:
      name: prod
      url: https://x.example
    runs-on: ubuntu-latest
    steps:
      - uses: docker://semgrep/semgrep
  shared:
    uses: acme/ci/.github/workflows/scan.yml@v1
`;

const parsed = () => parse(WORKFLOW, { file: FILE });
const job = (id: string) => parsed().pipeline.jobs.find((entry) => entry.id === id);

describe("lecture d'un workflow", () => {
  test("le fournisseur, le fichier, l'ordre du fichier", () => {
    const { pipeline } = parsed();
    expect(pipeline.provider).toBe("github");
    expect(pipeline.main).toBe(FILE);
    expect(pipeline.jobs.map((entry) => entry.id)).toEqual(["build", "test", "deploy", "shared"]);
  });

  test("les stages sont dérivés de needs", () => {
    const { pipeline } = parsed();
    expect(pipeline.stages.map((stage) => stage.name)).toEqual(["level 1", "level 2", "level 3"]);
    expect(pipeline.stages.every((stage) => stage.implicit)).toBe(true);
    expect(job("build")?.stage.value).toBe("level 1");
    expect(job("test")?.stage.value).toBe("level 2");
    expect(job("deploy")?.stage.value).toBe("level 3");
  });

  test("needs en scalaire et en liste", () => {
    expect(job("test")?.needs?.value.map((need) => need.job)).toEqual(["build"]);
    expect(job("deploy")?.needs?.value.map((need) => need.job)).toEqual(["build", "test"]);
    expect(job("build")?.needs).toBeNull();
  });

  test("environnement en scalaire ou en objet", () => {
    expect(job("deploy")?.environment?.value).toEqual({
      name: "prod",
      url: "https://x.example",
    });
    const text = "jobs:\n  a:\n    environment: prod\n    steps:\n      - run: x\n";
    expect(parse(text, { file: FILE }).pipeline.jobs[0]?.environment?.value).toEqual({
      name: "prod",
    });
  });

  test("les signaux : run, container, action, docker://", () => {
    expect(job("build")?.signals).toEqual({
      image: null,
      script: ["make"],
      actions: ["actions/checkout@v4"],
    });
    expect(job("test")?.signals.image).toBe("aquasec/trivy:0.50");
    expect(job("test")?.signals.script[0]).toContain("trivy fs .");
    expect(job("deploy")?.signals.image).toBe("semgrep/semgrep");
  });

  test("un job uses: est signalé, et le pipeline devient partiel", () => {
    const result = parsed();
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["WORKFLOW_UNRESOLVED"]);
    expect(isPartial(result.pipeline)).toBe(true);
    expect(result.pipeline.unresolved[0]).toMatchObject({
      form: "workflow",
      detail: "acme/ci/.github/workflows/scan.yml@v1",
    });
  });

  test("les clés non modélisées restent opaques, au job et au fichier", () => {
    expect(job("build")?.opaque.map((block) => block.key)).toEqual(["runs-on", "steps"]);
    expect(parsed().pipeline.opaque.map((block) => block.key)).toEqual(["name", "on"]);
    const block = job("build")?.opaque[0];
    expect(WORKFLOW.slice(block?.range.start, block?.range.end)).toBe("runs-on: ubuntu-latest");
  });

  test("un job sans étapes est signalé", () => {
    const { diagnostics } = parse("jobs:\n  a:\n    runs-on: x\n", { file: FILE });
    expect(diagnostics.map((entry) => entry.code)).toEqual(["JOB_WITHOUT_SCRIPT"]);
  });

  test("un cycle se dessine quand même", () => {
    const { pipeline } = parse(
      "jobs:\n  a:\n    needs: b\n    steps: [{run: x}]\n  b:\n    needs: a\n    steps: [{run: x}]\n",
      { file: FILE },
    );
    expect(pipeline.jobs).toHaveLength(2);
  });

  test.each([
    ["vide", ""],
    ["scalaire", "bonjour\n"],
    ["alias sans ancre", "*x\n"],
    ["YAML cassé", "jobs: [\n"],
    ["jobs n'est pas une map", "jobs: 3\n"],
  ])("%s rend un pipeline vide sans lever", (_label, text) => {
    expect(parse(text, { file: FILE }).pipeline.jobs).toEqual([]);
  });
});
