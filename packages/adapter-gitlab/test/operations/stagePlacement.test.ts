import { describe, expect, test } from "bun:test";
import { parse } from "../../src/parse.ts";
import { expectOk, jobOf, roundTrip } from "../support/apply.ts";
import { readEdgeCase } from "../support/corpus.ts";

const JOB = "\ncompile:\n  stage: build\n  script: make\n";
const WITH_FIXED = `stages:\n  - .pre\n  - build\n  - test\n  - .post\n${JOB}`;

function names(text: string): string[] {
  return parse(text).pipeline.stages.map((stage) => stage.name);
}

/** “.pre is always the first stage in a pipeline, .post always the last”: GitLab pins them, whatever
 *  their place in `stages`. <https://docs.gitlab.com/ci/yaml/#stage-pre> */
describe(".pre and .post stay at the ends", () => {
  test("a declared list is displayed with .pre first and .post last", () => {
    expect(names(`stages:\n  - build\n  - .post\n  - test\n  - .pre\n${JOB}`)).toEqual([
      ".pre",
      "build",
      "test",
      ".post",
    ]);
  });

  test("a stage added without an index goes before .post", () => {
    const applied = expectOk(WITH_FIXED, { kind: "addStage", name: "deploy" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "build",
      "test",
      "deploy",
      ".post",
    ]);
    expect(applied.text).toContain("  - test\n  - deploy\n  - .post\n");
  });

  test("a stage added at the end of a materialised list goes before .post", () => {
    const applied = expectOk("solo:\n  script: x\n", { kind: "addStage", name: "verify" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "build",
      "test",
      "deploy",
      "verify",
      ".post",
    ]);
  });

  test("a stage added at index 0 goes after .pre", () => {
    const applied = expectOk(WITH_FIXED, { kind: "addStage", name: "lint", index: 0 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "lint",
      "build",
      "test",
      ".post",
    ]);
  });

  test("a stage moved past .post stops before it", () => {
    const applied = expectOk(WITH_FIXED, { kind: "moveStage", name: "build", toIndex: 3 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "test",
      "build",
      ".post",
    ]);
  });

  test("moving .post itself changes nothing", () => {
    const applied = expectOk(WITH_FIXED, { kind: "moveStage", name: ".post", toIndex: 0 });
    expect(applied.text).toBe(WITH_FIXED);
  });

  test("a stage listed after .post is inserted next to its displayed neighbour", () => {
    const odd = `stages:\n  - build\n  - .post\n  - test\n${JOB}`;
    const applied = expectOk(odd, { kind: "addStage", name: "deploy" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "build",
      "test",
      "deploy",
      ".post",
    ]);
    roundTrip(odd, { kind: "addStage", name: "deploy" });
  });
});

describe("a comment standing alone in the stages list", () => {
  const commented = `stages:\n  - build\n  # quality gates below\n  - test\n  - deploy\n${JOB}`;

  test("stays above the item that followed it when the stage above it moves", () => {
    const applied = expectOk(commented, { kind: "moveStage", name: "build", toIndex: 2 });
    expect(applied.text).toBe(
      `stages:\n  # quality gates below\n  - test\n  - deploy\n  - build\n${JOB}`,
    );
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["test", "deploy", "build"]);
  });

  test("stays between its two neighbours when the last stage moves to the front", () => {
    const applied = expectOk(commented, { kind: "moveStage", name: "deploy", toIndex: 0 });
    expect(applied.text).toBe(
      `stages:\n  - deploy\n  - build\n  # quality gates below\n  - test\n${JOB}`,
    );
  });

  test("stays above the item that followed it when a stage is added next to it", () => {
    const applied = expectOk(commented, { kind: "addStage", name: "lint", index: 1 });
    expect(applied.text).toBe(
      `stages:\n  - build\n  # quality gates below\n  - lint\n  - test\n  - deploy\n${JOB}`,
    );
    roundTrip(commented, { kind: "moveStage", name: "build", toIndex: 2 });
  });

  test("a trailing comment after the last item stays after the list", () => {
    const trailing = `stages:\n  - build\n  - test\n  # end of stages\n${JOB}`;
    const applied = expectOk(trailing, { kind: "moveStage", name: "test", toIndex: 0 });
    expect(applied.text).toBe(`stages:\n  - test\n  - build\n  # end of stages\n${JOB}`);
  });
});

describe("a comment inside a multi-line flow stages list", () => {
  const flow = `stages: [build, # c\n  test]\n${JOB}`;

  test("stays on the first line when the stage before it moves after the next one", () => {
    const applied = expectOk(flow, { kind: "moveStage", name: "build", toIndex: 1 });
    expect(applied.text).toBe(`stages: [ # c\n  test, build]\n${JOB}`);
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["test", "build"]);
    roundTrip(flow, { kind: "moveStage", name: "build", toIndex: 1 });
  });

  test("stays after the stage it followed when the stage after it moves to the front", () => {
    const applied = expectOk(flow, { kind: "moveStage", name: "test", toIndex: 0 });
    expect(applied.text).toBe(`stages: [test, build # c\n  ]\n${JOB}`);
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["test", "build"]);
    roundTrip(flow, { kind: "moveStage", name: "test", toIndex: 0 });
  });

  test("a comment written before the comma survives moving the stage it follows", () => {
    const before = `stages: [build # c\n  , test, deploy]\n${JOB}`;
    const applied = expectOk(before, { kind: "moveStage", name: "build", toIndex: 2 });
    expect(applied.text).toBe(`stages: [ # c\n   test, deploy, build]\n${JOB}`);
    roundTrip(before, { kind: "moveStage", name: "build", toIndex: 2 });
  });

  test("the corpus fixture keeps its comment through every move", () => {
    const fixture = readEdgeCase("flow-stages-comment");
    for (const name of ["build", "test", "deploy"]) {
      for (const toIndex of [0, 1, 2]) {
        const applied = expectOk(fixture, { kind: "moveStage", name, toIndex });
        expect(applied.text.match(/# quality gates below\n/g)?.length).toBe(1);
        roundTrip(fixture, { kind: "moveStage", name, toIndex });
      }
    }
    expect(expectOk(fixture, { kind: "moveStage", name: "build", toIndex: 2 }).text).toStartWith(
      "stages: [ # quality gates below\n  test, deploy, build]\n",
    );
  });
});

describe("stage names YAML 1.1 would not read as strings", () => {
  const quoted = `stages:\n  - build\n  - 'yes'\n${JOB}`;

  test("moving a quoted stage keeps its quotes", () => {
    const applied = expectOk(quoted, { kind: "moveStage", name: "yes", toIndex: 0 });
    expect(applied.text).toContain("  - 'yes'\n  - build\n");
  });

  test("an added stage named yes is quoted", () => {
    const applied = expectOk(`stages:\n  - build\n${JOB}`, { kind: "addStage", name: "yes" });
    expect(applied.text).toContain('  - "yes"\n');
  });

  test("setJobStage to yes writes it quoted", () => {
    const applied = expectOk(quoted, { kind: "setJobStage", id: "compile", stage: "yes" });
    expect(applied.text).toContain('  stage: "yes"\n');
    expect(jobOf(applied.text, "compile").stage.value).toBe("yes");
  });

  test("addJob in a stage named on writes it quoted", () => {
    const applied = expectOk(`stages:\n  - "on"\n${JOB.replace("build", '"on"')}`, {
      kind: "addJob",
      job: { id: "x", stage: "on", script: ["a"] },
    });
    expect(applied.text).toContain('x:\n  stage: "on"\n');
  });

  test("addSnippet in a stage named yes writes it quoted", () => {
    const applied = expectOk(quoted, {
      kind: "addSnippet",
      id: "scan",
      stage: "yes",
      snippet: "scan:\n  script:\n    - run\n",
    });
    expect(applied.text).toContain('scan:\n  stage: "yes"\n');
  });
});
