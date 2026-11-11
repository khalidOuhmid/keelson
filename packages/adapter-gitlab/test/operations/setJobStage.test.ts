import { describe, expect, test } from "bun:test";
import { INVALID_OPERATION } from "@keelson/core";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

describe("setJobStage", () => {
  test("replaces the value of the locally declared stage", () => {
    const applied = expectOk(BASE, { kind: "setJobStage", id: "compile", stage: "test" });
    expect(jobOf(applied.text, "compile").stage).toEqual({
      value: "test",
      origin: { kind: "local" },
    });
  });

  test("touches only a single range", () => {
    const applied = expectOk(BASE, { kind: "setJobStage", id: "compile", stage: "test" });
    expect(applied.touched).toHaveLength(1);
    expect(applied.text.slice(applied.touched[0]?.start, applied.touched[0]?.end)).toBe("test");
  });

  test("preserves an inline comment on the stage key", () => {
    const commente = BASE.replace("  stage: build\n", "  stage: build # le stage\n");
    const applied = expectOk(commente, { kind: "setJobStage", id: "compile", stage: "test" });
    expect(applied.text).toContain("stage: test # le stage");
  });

  test("writes a local override when the stage comes from the default", () => {
    const texte = [
      "stages:",
      "  - build",
      "  - test",
      "",
      "solo:",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(texte, { kind: "setJobStage", id: "solo", stage: "build" });
    expect(jobOf(applied.text, "solo").stage).toEqual({
      value: "build",
      origin: { kind: "local" },
    });
    expect(applied.text).toContain("solo:\n  stage: build\n  script:");
  });

  test("writes a local override without touching the inherited template", () => {
    const texte = [
      ".base:",
      "  stage: build",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "herite:",
      "  extends: .base",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(texte, { kind: "setJobStage", id: "herite", stage: "test" });
    expect(applied.text).toContain(".base:\n  stage: build");
    expect(jobOf(applied.text, "herite").stage).toEqual({
      value: "test",
      origin: { kind: "local" },
    });
  });

  test("writes a local override without touching the inherited anchor", () => {
    const texte = [
      ".base: &base",
      "  stage: build",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "boulot:",
      "  <<: *base",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(texte, { kind: "setJobStage", id: "boulot", stage: "test" });
    expect(applied.text).toContain(".base: &base\n  stage: build");
    expect(jobOf(applied.text, "boulot").stage.origin).toEqual({ kind: "local" });
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(BASE, { kind: "setJobStage", id: "compile", stage: "deploy" });
    const texte = ["stages:", "  - build", "", "solo:", "  script:", "    - x", ""].join("\n");
    roundTrip(texte, { kind: "setJobStage", id: "solo", stage: "build" });
  });

  test("JOB_NOT_FOUND if the job does not exist", () => {
    expectUnchanged(BASE, { kind: "setJobStage", id: "absent", stage: "test" }, "JOB_NOT_FOUND");
  });

  test("STAGE_NOT_FOUND if the stage is not declared", () => {
    expectUnchanged(
      BASE,
      { kind: "setJobStage", id: "compile", stage: "inconnu" },
      "STAGE_NOT_FOUND",
    );
  });

  test("accepts an implicit stage when stages is absent", () => {
    const texte = "solo:\n  script:\n    - x\n";
    const applied = expectOk(texte, { kind: "setJobStage", id: "solo", stage: "deploy" });
    expect(jobOf(applied.text, "solo").stage.value).toBe("deploy");
  });
});

describe("setJobStage refuses what a key rewrite would lose", () => {
  const HEAD = "stages:\n  - build\n  - test\n\n.base:\n  stage: build\n\ncompile:\n";
  const draft = { kind: "setJobStage", id: "compile", stage: "test" } as const;

  for (const [label, stage] of [
    ["an anchor on the value", "  stage: &s !reference [.base, stage]\n"],
    ["a comment on the tag", "  stage: !reference # garde\n    - .base\n    - stage\n"],
    ["a comment between the items", "  stage: !reference\n    - .base # garde\n    - stage\n"],
    ["an explicit key", "  ? stage\n  : !reference [.base, stage]\n"],
  ] as const) {
    test(`${label}`, () => {
      const error = expectUnchanged(`${HEAD}${stage}  script: x\n`, draft, INVALID_OPERATION);
      expect(error.params).toEqual({ reason: "sharedValue", job: "compile", key: "stage" });
    });
  }
});
