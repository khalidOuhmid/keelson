import { describe, expect, test } from "bun:test";
import { JOB_REFERENCED, renderMessage } from "@keelson/core/messages";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("removeJob", () => {
  test("removes the job's complete key/value pair", () => {
    const applied = expectOk(BASE, { kind: "removeJob", id: "unit" });
    expect(applied.text).toBe(
      [
        "stages:",
        "  - build",
        "  - test",
        "  - deploy",
        "",
        "compile:",
        "  stage: build",
        "  script:",
        "    - make",
        "",
      ].join("\n"),
    );
  });

  test("the job disappears from the IR", () => {
    const applied = expectOk(BASE, { kind: "removeJob", id: "unit" });
    expect(applied.pipeline.jobs.map((job) => job.id)).toEqual(["compile"]);
  });

  test("also removes the empty separator line that follows", () => {
    const withoutNeeds = [
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "unit:",
      "  stage: test",
      "  script:",
      "    - make check",
      "",
    ].join("\n");
    const applied = expectOk(withoutNeeds, { kind: "removeJob", id: "compile" });
    expect(applied.text).toBe(
      [
        "stages:",
        "  - build",
        "  - test",
        "",
        "unit:",
        "  stage: test",
        "  script:",
        "    - make check",
        "",
      ].join("\n"),
    );
  });

  test("preserves the comment preceding the next job", () => {
    const withComment = [
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "# about unit",
      "unit:",
      "  stage: test",
      "  script:",
      "    - make check",
      "",
    ].join("\n");
    const applied = expectOk(withComment, { kind: "removeJob", id: "compile" });
    expect(applied.text).toContain("# about unit");
  });

  test("removes the last job of a file", () => {
    const applied = expectOk(BASE, { kind: "removeJob", id: "unit" });
    expect(applied.text.endsWith("    - make\n")).toBe(true);
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(BASE, { kind: "removeJob", id: "unit" });
  });

  test("JOB_NOT_FOUND if the job does not exist", () => {
    expectUnchanged(BASE, { kind: "removeJob", id: "absent" }, "JOB_NOT_FOUND");
  });

  test("JOB_NOT_FOUND for a template", () => {
    const withTemplate = `.base:\n  image: node\n\n${BASE}`;
    expectUnchanged(withTemplate, { kind: "removeJob", id: ".base" }, "JOB_NOT_FOUND");
  });

  test("JOB_REFERENCED if another job needs it", () => {
    const error = expectUnchanged(BASE, { kind: "removeJob", id: "compile" }, "JOB_REFERENCED");
    expect(renderMessage(error)).toContain("unit");
  });

  test("JOB_REFERENCED lists the jobs that reference it in params", () => {
    const error = expectUnchanged(BASE, { kind: "removeJob", id: "compile" }, "JOB_REFERENCED");
    expect(error.code === JOB_REFERENCED ? error.params.referencedBy : null).toEqual(["unit"]);
  });

  test("removing the dependent first then allows removing the target", () => {
    const withoutUnit = expectOk(BASE, { kind: "removeJob", id: "unit" });
    const empty = expectOk(withoutUnit.text, { kind: "removeJob", id: "compile" });
    expect(empty.pipeline.jobs).toEqual([]);
  });
});
