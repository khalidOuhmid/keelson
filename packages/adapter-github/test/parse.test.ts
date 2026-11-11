import { describe, expect, test } from "bun:test";
import { hashText, validate } from "@keelson/core";
import { isWorkflowPath, parse } from "../src/index.ts";

const FILE = ".github/workflows/ci.yml";

const WORKFLOW = `name: CI
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: |
          npm run build
          npm test
  sast:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript
      - uses: github/codeql-action/analyze@v3
  image:
    runs-on: ubuntu-latest
    container: aquasec/trivy:0.50.0
    needs: [build, sast]
    steps:
      - run: trivy fs .
  deploy:
    runs-on: ubuntu-latest
    needs: [image]
    environment:
      name: production
      url: https://example.com
    steps:
      - run: ./deploy.sh
`;

describe("isWorkflowPath", () => {
  test("reconnaît un workflow sous .github/workflows", () => {
    expect(isWorkflowPath(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkflowPath(".github/workflows/release.yaml")).toBe(true);
  });

  test("refuse ce qui n'est pas un workflow de premier niveau", () => {
    expect(isWorkflowPath(".github/workflows/sub/ci.yml")).toBe(false);
    expect(isWorkflowPath(".github/dependabot.yml")).toBe(false);
    expect(isWorkflowPath(".gitlab-ci.yml")).toBe(false);
    expect(isWorkflowPath(".github/workflows/notes.md")).toBe(false);
  });
});

describe("parse", () => {
  const { pipeline, diagnostics, hash } = parse(WORKFLOW, { file: FILE });

  test("rend le hash du texte et un pipeline rattaché à son fichier", () => {
    expect(hash).toBe(hashText(WORKFLOW));
    expect(pipeline.main).toBe(FILE);
    expect(pipeline.files).toEqual([FILE]);
    expect(pipeline.unresolved).toEqual([]);
    expect(pipeline.templates).toEqual([]);
  });

  test("chaque job de jobs: devient un job de l'IR, dans l'ordre du fichier", () => {
    expect(pipeline.jobs.map((job) => job.id)).toEqual(["build", "sast", "image", "deploy"]);
    for (const job of pipeline.jobs) {
      expect(job.file).toBe(FILE);
      expect(WORKFLOW.slice(job.range.start, job.range.end).startsWith(`${job.id}:`)).toBe(true);
    }
  });

  test("needs en chaîne ou en liste, jamais optionnels", () => {
    const needs = (id: string) =>
      pipeline.jobs.find((job) => job.id === id)?.needs?.value.map((need) => need.job) ?? null;
    expect(needs("build")).toBeNull();
    expect(needs("sast")).toEqual(["build"]);
    expect(needs("image")).toEqual(["build", "sast"]);
    expect(pipeline.jobs[1]?.needs?.value[0]).toEqual({
      job: "build",
      optional: false,
      artifacts: false,
    });
  });

  test("les stages sont les niveaux de dépendance, implicites", () => {
    expect(pipeline.stages.map((stage) => stage.name)).toEqual([
      "level 1",
      "level 2",
      "level 3",
      "level 4",
    ]);
    expect(pipeline.stages.every((stage) => stage.implicit && stage.range === null)).toBe(true);
    expect(pipeline.jobs.map((job) => job.stage.value)).toEqual([
      "level 1",
      "level 2",
      "level 3",
      "level 4",
    ]);
    expect(pipeline.jobs[0]?.stage.origin).toEqual({ kind: "default" });
  });

  test("environment en map ou en chaîne", () => {
    expect(pipeline.jobs.find((job) => job.id === "deploy")?.environment?.value).toEqual({
      name: "production",
      url: "https://example.com",
    });
    const short = parse("jobs:\n  a:\n    environment: staging\n    steps:\n      - run: x\n", {
      file: FILE,
    });
    expect(short.pipeline.jobs[0]?.environment?.value).toEqual({ name: "staging" });
  });

  test("les signaux portent les run, l'image du conteneur et les actions sans leur version", () => {
    const build = pipeline.jobs.find((job) => job.id === "build");
    expect(build?.signals).toEqual({
      image: null,
      script: ["npm ci", "npm run build", "npm test"],
      actions: ["actions/checkout"],
    });
    expect(pipeline.jobs.find((job) => job.id === "sast")?.signals.actions).toEqual([
      "github/codeql-action/init",
      "github/codeql-action/analyze",
    ]);
    expect(pipeline.jobs.find((job) => job.id === "image")?.signals.image).toBe(
      "aquasec/trivy:0.50.0",
    );
    const mapped = parse(
      "jobs:\n  a:\n    container:\n      image: node:20\n    steps:\n      - run: x\n",
      { file: FILE },
    );
    expect(mapped.pipeline.jobs[0]?.signals.image).toBe("node:20");
  });

  test("ce que l'IR ne modélise pas reste opaque, avec sa plage exacte", () => {
    const build = pipeline.jobs.find((job) => job.id === "build");
    expect(build?.opaque.map((block) => block.key)).toEqual(["runs-on", "steps"]);
    const steps = build?.opaque.find((block) => block.key === "steps");
    expect(steps === undefined ? "" : WORKFLOW.slice(steps.range.start, steps.range.end)).toMatch(
      /^steps:\n\s+- uses: actions\/checkout@v4/,
    );
    expect(pipeline.opaque.map((block) => block.key)).toEqual(["name", "on", "permissions"]);
  });

  test("un pipeline bien formé ne lève aucun diagnostic, y compris à la validation", () => {
    expect(diagnostics).toEqual([]);
    expect(validate(pipeline)).toEqual([]);
  });

  test("un job sans steps ni uses est signalé", () => {
    const empty = parse("jobs:\n  lonely:\n    runs-on: ubuntu-latest\n", { file: FILE });
    expect(empty.diagnostics.map((entry) => entry.code)).toEqual(["JOB_WITHOUT_SCRIPT"]);
    expect(empty.diagnostics[0]?.file).toBe(FILE);
  });

  test("un workflow réutilisable appelé par un job compte comme une action", () => {
    const called = parse("jobs:\n  call:\n    uses: org/shared/.github/workflows/scan.yml@main\n", {
      file: FILE,
    });
    expect(called.diagnostics).toEqual([]);
    expect(called.pipeline.jobs[0]?.signals.actions).toEqual([
      "org/shared/.github/workflows/scan.yml",
    ]);
  });

  test("un YAML invalide rend ses erreurs, sans lever", () => {
    const broken = parse("jobs:\n  a: [\n", { file: FILE });
    expect(broken.diagnostics.some((entry) => entry.code === "INVALID_YAML")).toBe(true);
  });

  test("une racine qui n'est pas une map rend un pipeline vide", () => {
    const scalar = parse("hello\n", { file: FILE });
    expect(scalar.pipeline.jobs).toEqual([]);
    expect(scalar.pipeline.main).toBe(FILE);
  });

  test("un need inconnu ou un cycle reste visible à la validation sans casser les niveaux", () => {
    const cyclic = parse(
      "jobs:\n  a:\n    needs: b\n    steps: [{run: x}]\n  b:\n    needs: a\n    steps: [{run: x}]\n  c:\n    needs: ghost\n    steps: [{run: x}]\n",
      { file: FILE },
    );
    const codes = validate(cyclic.pipeline).map((entry) => entry.code);
    expect(codes).toContain("NEEDS_CYCLE");
    expect(codes).toContain("UNKNOWN_NEED");
    const stages = new Set(cyclic.pipeline.stages.map((stage) => stage.name));
    expect(cyclic.pipeline.jobs.every((job) => stages.has(job.stage.value))).toBe(true);
  });
});
