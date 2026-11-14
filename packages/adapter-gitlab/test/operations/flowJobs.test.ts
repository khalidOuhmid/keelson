import { describe, expect, test } from "bun:test";
import { expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const FLOW = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile: { stage: build, script: make }",
  "pack: {stage: build, script: pack}",
  "unit: { stage: test, needs: [compile], environment: review, script: test }",
  "bare: {script: x}",
  "",
].join("\n");

describe("a job written in flow style", () => {
  test("setJobStage replaces a written stage", () => {
    const applied = expectOk(FLOW, { kind: "setJobStage", id: "compile", stage: "test" });
    expect(applied.text).toContain("compile: { stage: test, script: make }");
    roundTrip(FLOW, { kind: "setJobStage", id: "compile", stage: "test" });
  });

  test("setJobStage adds a stage at the end of the map", () => {
    const applied = expectOk(FLOW, { kind: "setJobStage", id: "bare", stage: "build" });
    expect(applied.text).toContain("bare: {script: x, stage: build}");
    expect(jobOf(applied.text, "bare").stage.value).toBe("build");
    roundTrip(FLOW, { kind: "setJobStage", id: "bare", stage: "build" });
  });

  test("addNeed extends a flow needs list", () => {
    const applied = expectOk(FLOW, { kind: "addNeed", id: "unit", need: { job: "pack" } });
    expect(jobOf(applied.text, "unit").needs?.value.map((need) => need.job)).toEqual([
      "compile",
      "pack",
    ]);
  });

  test("addNeed writes a needs list into a map that has none", () => {
    const applied = expectOk(FLOW, {
      kind: "addNeed",
      id: "bare",
      need: { job: "compile", optional: true },
    });
    expect(applied.text).toContain("bare: {script: x, needs: [{ job: compile, optional: true }]}");
    roundTrip(FLOW, { kind: "addNeed", id: "bare", need: { job: "compile" } });
  });

  test("removeNeed of the last need removes the key and its separator", () => {
    const applied = expectOk(FLOW, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(applied.text).toContain("unit: { stage: test, environment: review, script: test }");
    roundTrip(FLOW, { kind: "removeNeed", id: "unit", job: "compile" });
  });

  test("setEnvironment replaces a written environment, in flow form", () => {
    const applied = expectOk(FLOW, {
      kind: "setEnvironment",
      id: "unit",
      environment: { name: "prod", url: "https://prod.example.org" },
    });
    expect(applied.text).toContain(
      "environment: { name: prod, url: https://prod.example.org }, script: test }",
    );
    expect(jobOf(applied.text, "unit").environment?.value).toEqual({
      name: "prod",
      url: "https://prod.example.org",
    });
  });

  test("setEnvironment null removes the key", () => {
    const applied = expectOk(FLOW, { kind: "setEnvironment", id: "unit", environment: null });
    expect(applied.text).toContain("unit: { stage: test, needs: [compile], script: test }");
    roundTrip(FLOW, { kind: "setEnvironment", id: "unit", environment: null });
  });

  test("setEnvironment adds an environment to a map that has none", () => {
    const applied = expectOk(FLOW, {
      kind: "setEnvironment",
      id: "bare",
      environment: { name: "review" },
    });
    expect(applied.text).toContain("bare: {script: x, environment: review}");
  });

  test("renameJob and removeJob work on it", () => {
    const renamed = expectOk(FLOW, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(jobOf(renamed.text, "unit").needs?.value.map((need) => need.job)).toEqual(["build-app"]);
    const removed = expectOk(FLOW, { kind: "removeJob", id: "bare" });
    expect(removed.text).not.toContain("bare:");
  });

  test("an override goes after a merge key, where Psych lets it win", () => {
    const merged = `.base: &base {stage: build}\n${FLOW}merged: {<<: *base, script: m}\n`;
    const applied = expectOk(merged, { kind: "setJobStage", id: "merged", stage: "test" });
    expect(jobOf(applied.text, "merged").stage.value).toBe("test");
  });

  test("a multi-line flow map is edited in place", () => {
    const multi = `${FLOW}wide: {\n  stage: build,\n  script: w\n}\n`;
    const applied = expectOk(multi, {
      kind: "setEnvironment",
      id: "wide",
      environment: { name: "review" },
    });
    expect(jobOf(applied.text, "wide").environment?.value).toEqual({ name: "review" });
    roundTrip(multi, { kind: "setEnvironment", id: "wide", environment: { name: "review" } });
  });

  test("a comment between two entries stays when the entry before it is removed", () => {
    const commented = `${FLOW}noted: {\n  needs: [compile], # waits for the build\n  script: n\n}\n`;
    const applied = expectOk(commented, { kind: "removeNeed", id: "noted", job: "compile" });
    expect(applied.text).toContain("# waits for the build");
    expect(jobOf(applied.text, "noted").needs).toBeNull();
    roundTrip(commented, { kind: "removeNeed", id: "noted", job: "compile" });
  });

  test("a comment before the last entry stays when it is removed", () => {
    const commented = `${FLOW}noted: {\n  script: n, # review app\n  environment: review\n}\n`;
    const applied = expectOk(commented, { kind: "setEnvironment", id: "noted", environment: null });
    expect(applied.text).toContain("noted: {\n  script: n, # review app\n}\n");
    expect(jobOf(applied.text, "noted").environment).toBeNull();
  });

  test("an inherited environment is cancelled with environment: null", () => {
    const inherited = `.deploy: {environment: prod}\n${FLOW}ship: {extends: .deploy, script: s}\n`;
    const applied = expectOk(inherited, { kind: "setEnvironment", id: "ship", environment: null });
    expect(applied.text).toContain("ship: {extends: .deploy, script: s, environment: null}");
    expect(jobOf(applied.text, "ship").environment).toBeNull();
  });

  test("a local environment over an inherited one becomes environment: null", () => {
    const inherited = `.deploy: {environment: prod}\n${FLOW}ship: {extends: .deploy, environment: review, script: s}\n`;
    const applied = expectOk(inherited, { kind: "setEnvironment", id: "ship", environment: null });
    expect(applied.text).toContain("ship: {extends: .deploy, environment: null, script: s}");
  });

  test("removing an inherited need writes the remaining list", () => {
    const inherited = `.waits: {needs: [compile, pack]}\n${FLOW}late: {extends: .waits, script: l}\n`;
    const applied = expectOk(inherited, { kind: "removeNeed", id: "late", job: "compile" });
    expect(applied.text).toContain("late: {extends: .waits, script: l, needs: [pack]}");
  });

  test("a job in a flow-style root stays refused", () => {
    const root = "{stages: [build], compile: {stage: build, script: make}}\n";
    expectUnchanged(
      root,
      { kind: "setJobStage", id: "compile", stage: "build" },
      "INVALID_OPERATION",
    );
  });
});
