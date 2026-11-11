import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("moveStage", () => {
  test("moves a stage to the start", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "deploy", toIndex: 0 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["deploy", "build", "test"]);
  });

  test("moves a stage to the end", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "build", toIndex: 2 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["test", "deploy", "build"]);
  });

  test("moving to the same index leaves the order unchanged", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "test", toIndex: 1 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual(["build", "test", "deploy"]);
  });

  test("does not touch the jobs", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "deploy", toIndex: 0 });
    expect(applied.text).toContain("compile:\n  stage: build\n  script:\n    - make\n");
    expect(applied.pipeline.jobs.map((job) => job.id)).toEqual(["compile", "unit"]);
  });

  test("materialises the list when the stages are implicit", () => {
    const applied = expectOk("solo:\n  script:\n    - x\n", {
      kind: "moveStage",
      name: "deploy",
      toIndex: 0,
    });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "deploy",
      ".pre",
      "build",
      "test",
      ".post",
    ]);
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(BASE, { kind: "moveStage", name: "deploy", toIndex: 0 });
    roundTrip(BASE, { kind: "moveStage", name: "build", toIndex: 2 });
    roundTrip("solo:\n  script:\n    - x\n", { kind: "moveStage", name: "deploy", toIndex: 0 });
  });

  test("STAGE_NOT_FOUND if the stage does not exist", () => {
    expectUnchanged(BASE, { kind: "moveStage", name: "absent", toIndex: 0 }, "STAGE_NOT_FOUND");
  });

  test("RANGE_OUT_OF_BOUNDS if the target index is past the list", () => {
    expectUnchanged(BASE, { kind: "moveStage", name: "build", toIndex: 9 }, "RANGE_OUT_OF_BOUNDS");
  });
});

describe("moveStage without effect", () => {
  test("moving a stage to its own position touches nothing", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "test", toIndex: 1 });
    expect(applied.text).toBe(BASE);
    expect(applied.touched).toEqual([]);
  });

  test("the no-effect case stays undoable", () => {
    roundTrip(BASE, { kind: "moveStage", name: "test", toIndex: 1 });
  });

  test("moving the first stage to index 0 touches nothing", () => {
    const applied = expectOk(BASE, { kind: "moveStage", name: "build", toIndex: 0 });
    expect(applied.text).toBe(BASE);
  });

  test("never throws on a commented file", () => {
    const commente = [
      "stages:",
      "  - build # un commentaire",
      "  - test",
      "",
      "boulot:",
      "  stage: build",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    for (let index = 0; index < 2; index += 1) {
      for (const name of ["build", "test"]) {
        expect(() => expectOk(commente, { kind: "moveStage", name, toIndex: index })).not.toThrow();
      }
    }
  });
});
