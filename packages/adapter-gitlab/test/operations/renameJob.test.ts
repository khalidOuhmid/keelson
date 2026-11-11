import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

describe("renameJob", () => {
  test("renames the job's key", () => {
    const applied = expectOk(BASE, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.pipeline.jobs.map((job) => job.id)).toEqual(["build-app", "unit"]);
  });

  test("updates string-form references in needs", () => {
    const applied = expectOk(BASE, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "build-app", optional: false, artifacts: true },
    ]);
  });

  test("updates object-form references in needs", () => {
    const objectForm = BASE.replace(
      "    - compile\n",
      "    - job: compile\n      artifacts: false\n",
    );
    const applied = expectOk(objectForm, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "build-app", optional: false, artifacts: false },
    ]);
  });

  test("updates references in flow style", () => {
    const flow = BASE.replace("  needs:\n    - compile\n", "  needs: [compile]\n");
    const applied = expectOk(flow, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain("needs: [build-app]");
  });

  test("updates references carried by a template", () => {
    const withTemplate = [".shared:", "  needs:", "    - compile", "", BASE].join("\n");
    const applied = expectOk(withTemplate, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain(".shared:\n  needs:\n    - build-app");
  });

  test("does not touch a homonymous string elsewhere in the file", () => {
    const trap = BASE.replace("    - make\n", "    - make compile\n");
    const applied = expectOk(trap, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain("- make compile");
  });

  test("does not touch a homonymous stage", () => {
    const source = [
      "stages:",
      "  - compile",
      "",
      "compile:",
      "  stage: compile",
      "  script:",
      "    - make",
      "",
    ].join("\n");
    const applied = expectOk(source, { kind: "renameJob", from: "compile", to: "other" });
    expect(applied.pipeline.stages.map((s) => s.name)).toEqual(["compile"]);
    expect(jobOf(applied.text, "other").stage.value).toBe("compile");
  });

  test("preserves the comments of the renamed job", () => {
    const commented = BASE.replace("compile:\n", "compile: # a comment\n");
    const applied = expectOk(commented, { kind: "renameJob", from: "compile", to: "build-app" });
    expect(applied.text).toContain("build-app: # a comment");
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(BASE, { kind: "renameJob", from: "compile", to: "build-app" });
  });

  test("JOB_NOT_FOUND if the source does not exist", () => {
    expectUnchanged(BASE, { kind: "renameJob", from: "absent", to: "x" }, "JOB_NOT_FOUND");
  });

  test("NAME_CONFLICT if the target already exists", () => {
    expectUnchanged(BASE, { kind: "renameJob", from: "compile", to: "unit" }, "NAME_CONFLICT");
  });

  test("INVALID_NAME if the target is empty, hidden or reserved", () => {
    for (const to of ["", ".cache", "stages", "variables"]) {
      expectUnchanged(BASE, { kind: "renameJob", from: "compile", to }, "INVALID_NAME");
    }
  });

  test("CYCLE if the rename creates a needs cycle", () => {
    const source = [
      "stages:",
      "  - test",
      "",
      "a:",
      "  stage: test",
      "  needs:",
      "    - future",
      "  script:",
      "    - x",
      "",
      "b:",
      "  stage: test",
      "  needs:",
      "    - a",
      "  script:",
      "    - y",
      "",
    ].join("\n");
    expectUnchanged(source, { kind: "renameJob", from: "b", to: "future" }, "CYCLE");
  });
});
