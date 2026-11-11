import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("addStage", () => {
  test("adds a stage at the end of the list without an index", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "verify" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "build",
      "test",
      "deploy",
      "verify",
    ]);
  });

  test("adds a stage at the requested index", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "verify", index: 1 });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "build",
      "verify",
      "test",
      "deploy",
    ]);
  });

  test("adds a stage at the head with index 0", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "prepare", index: 0 });
    expect(applied.pipeline.stages.map((stage) => stage.name)[0]).toBe("prepare");
  });

  test("keeps existing stages byte for byte", () => {
    const applied = expectOk(BASE, { kind: "addStage", name: "verify" });
    expect(applied.text).toContain("stages:\n  - build\n  - test\n  - deploy\n  - verify\n");
  });

  test("materialises the stages key with the default list when it is absent", () => {
    const sansStages = "solo:\n  script:\n    - x\n";
    const applied = expectOk(sansStages, { kind: "addStage", name: "verify" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "build",
      "test",
      "deploy",
      ".post",
      "verify",
    ]);
    for (const stage of applied.pipeline.stages) {
      expect(stage.implicit).toBe(false);
    }
  });

  test("materialisation keeps the job intact", () => {
    const sansStages = "solo:\n  script:\n    - x\n";
    const applied = expectOk(sansStages, { kind: "addStage", name: "verify" });
    expect(applied.text).toContain("solo:\n  script:\n    - x\n");
  });

  test("adds into a flow-style stage list", () => {
    const flow = BASE.replace(
      "stages:\n  - build\n  - test\n  - deploy\n",
      "stages: [build, test, deploy]\n",
    );
    const applied = expectOk(flow, { kind: "addStage", name: "verify" });
    expect(applied.pipeline.stages.map((stage) => stage.name)).toEqual([
      "build",
      "test",
      "deploy",
      "verify",
    ]);
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(BASE, { kind: "addStage", name: "verify" });
    roundTrip(BASE, { kind: "addStage", name: "verify", index: 0 });
    roundTrip("solo:\n  script:\n    - x\n", { kind: "addStage", name: "verify" });
  });

  test("STAGE_EXISTS if the stage is already declared", () => {
    expectUnchanged(BASE, { kind: "addStage", name: "test" }, "STAGE_EXISTS");
  });

  test("STAGE_EXISTS for an implicit stage", () => {
    expectUnchanged(
      "solo:\n  script:\n    - x\n",
      { kind: "addStage", name: "build" },
      "STAGE_EXISTS",
    );
  });

  test("INVALID_NAME if the name is empty", () => {
    expectUnchanged(BASE, { kind: "addStage", name: "" }, "INVALID_NAME");
  });

  test("RANGE_OUT_OF_BOUNDS if the index is past the list", () => {
    expectUnchanged(BASE, { kind: "addStage", name: "verify", index: 99 }, "RANGE_OUT_OF_BOUNDS");
  });
});
