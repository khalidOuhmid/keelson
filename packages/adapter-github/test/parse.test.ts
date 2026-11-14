import { describe, expect, test } from "bun:test";
import { isPartial, validate } from "@keelson/core";
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

describe("reading a workflow", () => {
  test("the provider, the file, the file order", () => {
    const { pipeline } = parsed();
    expect(pipeline.provider).toBe("github");
    expect(pipeline.main).toBe(FILE);
    expect(pipeline.jobs.map((entry) => entry.id)).toEqual(["build", "test", "deploy", "shared"]);
  });

  test("stages are derived from needs", () => {
    const { pipeline } = parsed();
    expect(pipeline.stages.map((stage) => stage.name)).toEqual(["level 1", "level 2", "level 3"]);
    // `implicit` means "GitLab assumes it": here, the column says only what `needs` says.
    expect(pipeline.stages.every((stage) => !stage.implicit)).toBe(true);
    expect(job("build")?.stage.value).toBe("level 1");
    expect(job("test")?.stage.value).toBe("level 2");
    expect(job("deploy")?.stage.value).toBe("level 3");
  });

  test("needs as a scalar and as a list", () => {
    expect(job("test")?.needs?.value.map((need) => need.job)).toEqual(["build"]);
    expect(job("deploy")?.needs?.value.map((need) => need.job)).toEqual(["build", "test"]);
    expect(job("build")?.needs).toBeNull();
  });

  test("environment as a scalar or an object", () => {
    expect(job("deploy")?.environment?.value).toEqual({
      name: "prod",
      url: "https://x.example",
    });
    const text = "jobs:\n  a:\n    environment: prod\n    steps:\n      - run: x\n";
    expect(parse(text, { file: FILE }).pipeline.jobs[0]?.environment?.value).toEqual({
      name: "prod",
    });
  });

  test("the signals: run, container, action, docker://", () => {
    expect(job("build")?.signals).toEqual({
      image: null,
      script: ["make"],
      actions: ["actions/checkout@v4"],
    });
    expect(job("test")?.signals.image).toBe("aquasec/trivy:0.50");
    expect(job("test")?.signals.script[0]).toContain("trivy fs .");
    expect(job("deploy")?.signals.image).toBe("semgrep/semgrep");
  });

  test("container and docker:// add up", () => {
    const text =
      "jobs:\n  a:\n    container: node:20\n    steps:\n      - uses: docker://aquasec/trivy\n";
    const { signals } = parse(text, { file: FILE }).pipeline.jobs[0] ?? {};
    expect(signals?.image).toBe("node:20");
    expect(signals?.actions).toEqual(["docker://aquasec/trivy"]);
  });

  test("a uses: job is reported, and the pipeline becomes partial", () => {
    const result = parsed();
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["WORKFLOW_UNRESOLVED"]);
    expect(isPartial(result.pipeline)).toBe(true);
    expect(result.pipeline.unresolved[0]).toMatchObject({
      form: "workflow",
      detail: "acme/ci/.github/workflows/scan.yml@v1",
    });
  });

  test("unmodelled keys stay opaque, at job and file level", () => {
    expect(job("build")?.opaque.map((block) => block.key)).toEqual(["runs-on", "steps"]);
    expect(parsed().pipeline.opaque.map((block) => block.key)).toEqual(["name", "on"]);
    const block = job("build")?.opaque[0];
    expect(WORKFLOW.slice(block?.range.start, block?.range.end)).toBe("runs-on: ubuntu-latest");
  });

  test("a job without steps is reported", () => {
    const { diagnostics } = parse("jobs:\n  a:\n    runs-on: x\n", { file: FILE });
    expect(diagnostics.map((entry) => entry.code)).toEqual(["JOB_WITHOUT_SCRIPT"]);
  });

  test("a cycle still renders", () => {
    const { pipeline } = parse(
      "jobs:\n  a:\n    needs: b\n    steps: [{run: x}]\n  b:\n    needs: a\n    steps: [{run: x}]\n",
      { file: FILE },
    );
    expect(pipeline.jobs).toHaveLength(2);
  });

  test("a cycle is drawn on one level and never reported as a later stage", () => {
    const { pipeline } = parse(
      "jobs:\n  a:\n    needs: b\n    steps: [{run: x}]\n  b:\n    needs: a\n    steps: [{run: x}]\n  c:\n    needs: a\n    steps: [{run: x}]\n",
      { file: FILE },
    );
    const levels = Object.fromEntries(pipeline.jobs.map((entry) => [entry.id, entry.stage.value]));
    expect(levels).toEqual({ a: "level 1", b: "level 1", c: "level 2" });
    expect(validate(pipeline).map((entry) => entry.code)).toEqual(["NEEDS_CYCLE"]);
  });

  test("an empty or non-map job is reported, not dropped in silence", () => {
    const { diagnostics, pipeline } = parse("jobs:\n  a:\n  b: 3\n  c:\n    steps: [{run: x}]\n", {
      file: FILE,
    });
    expect(pipeline.jobs.map((entry) => entry.id)).toEqual(["c"]);
    expect(
      diagnostics.map((entry): unknown[] => [entry.code, entry.severity, entry.params, entry.file]),
    ).toEqual([
      ["WORKFLOW_JOB_INVALID", "error", { reason: "notMap", job: "a" }, FILE],
      ["WORKFLOW_JOB_INVALID", "error", { reason: "notMap", job: "b" }, FILE],
    ]);
  });

  test("needs written as a map, or with a non-string item, is reported", () => {
    const { diagnostics } = parse(
      "jobs:\n  a:\n    needs: {job: b}\n    steps: [{run: x}]\n  b:\n    needs: [a, {x: 1}]\n    steps: [{run: x}]\n",
      { file: FILE },
    );
    expect(diagnostics.map((entry): unknown[] => [entry.code, entry.params])).toEqual([
      ["WORKFLOW_JOB_INVALID", { reason: "needs", job: "a" }],
      ["WORKFLOW_JOB_INVALID", { reason: "needs", job: "b" }],
    ]);
  });

  test("a jobs map written through an alias is read", () => {
    const text =
      "x-jobs: &j\n  a:\n    steps: [{run: trivy fs .}]\n  b:\n    needs: a\n    steps: [{run: x}]\non: push\njobs: *j\n";
    const { pipeline, diagnostics } = parse(text, { file: FILE });
    expect(pipeline.jobs.map((entry) => [entry.id, entry.needs?.value.map((n) => n.job)])).toEqual([
      ["a", undefined],
      ["b", ["a"]],
    ]);
    expect(diagnostics).toEqual([]);
  });

  test.each([
    ["empty", ""],
    ["scalar", "hello\n"],
    ["alias without anchor", "*x\n"],
    ["broken YAML", "jobs: [\n"],
    ["jobs is not a map", "jobs: 3\n"],
  ])("%s yields an empty pipeline without throwing", (_label, text) => {
    expect(parse(text, { file: FILE }).pipeline.jobs).toEqual([]);
  });
});
