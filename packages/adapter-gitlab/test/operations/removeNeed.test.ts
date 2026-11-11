import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const twoNeeds = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
  "package:",
  "  stage: build",
  "  script:",
  "    - pack",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "    - package",
  "  script:",
  "    - check",
  "",
].join("\n");

describe("removeNeed", () => {
  test("removes the targeted item while keeping the others", () => {
    const applied = expectOk(twoNeeds, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "package", optional: false, artifacts: true },
    ]);
  });

  test("removes the item's whole line", () => {
    const applied = expectOk(twoNeeds, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(applied.text).toContain("  needs:\n    - package\n");
  });

  test("removes the whole needs key when it was the last item", () => {
    const applied = expectOk(BASE, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs).toBeNull();
    expect(applied.text).not.toContain("needs");
  });

  test("removes an item in object form", () => {
    const objectForm = twoNeeds.replace(
      "    - compile\n",
      "    - job: compile\n      artifacts: false\n",
    );
    const applied = expectOk(objectForm, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "package", optional: false, artifacts: true },
    ]);
  });

  test("removes an item from a flow-style sequence", () => {
    const flow = twoNeeds.replace(
      "  needs:\n    - compile\n    - package\n",
      "  needs: [compile, package]\n",
    );
    const applied = expectOk(flow, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "package", optional: false, artifacts: true },
    ]);
  });

  test("writes a local override when the needs are inherited", () => {
    const inherited = [
      ".base:",
      "  needs:",
      "    - compile",
      "    - package",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "package:",
      "  stage: build",
      "  script:",
      "    - pack",
      "",
      "unit:",
      "  extends: .base",
      "  stage: test",
      "  script:",
      "    - check",
      "",
    ].join("\n");
    const applied = expectOk(inherited, { kind: "removeNeed", id: "unit", job: "compile" });
    expect(applied.text).toContain(".base:\n  needs:\n    - compile\n    - package\n");
    const needs = jobOf(applied.text, "unit").needs;
    expect(needs?.origin).toEqual({ kind: "local" });
    expect(needs?.value).toEqual([{ job: "package", optional: false, artifacts: true }]);
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(twoNeeds, { kind: "removeNeed", id: "unit", job: "compile" });
    roundTrip(BASE, { kind: "removeNeed", id: "unit", job: "compile" });
  });

  test("JOB_NOT_FOUND if the job does not exist", () => {
    expectUnchanged(
      twoNeeds,
      { kind: "removeNeed", id: "absent", job: "compile" },
      "JOB_NOT_FOUND",
    );
  });

  test("NEED_NOT_FOUND if the need is not present", () => {
    expectUnchanged(twoNeeds, { kind: "removeNeed", id: "unit", job: "absent" }, "NEED_NOT_FOUND");
  });

  test("NEED_NOT_FOUND when the job has no need", () => {
    const error = expectUnchanged(
      twoNeeds,
      { kind: "removeNeed", id: "compile", job: "package" },
      "NEED_NOT_FOUND",
    );
    expect(error.code === "NEED_NOT_FOUND" ? error.params.reason : null).toBe("notNeeded");
  });

  /** The need is indeed in the effective value, but the local list is not a sequence readable
   *  item by item: removing it would require rewriting the shared list. This path was covered by
   *  no test — flagged by the independent review of 2026-10-22, which saw that the rendered
   *  sentence there said the opposite of the condition leading to it. */
  describe("need coming from a shared list", () => {
    const sharedList = (line: string): string =>
      [
        "stages:",
        "  - build",
        "  - test",
        "",
        ".base:",
        "  needs: &shared",
        "    - compile",
        "    - lint",
        "",
        "compile:",
        "  stage: build",
        "  script: a",
        "",
        "lint:",
        "  stage: build",
        "  script: l",
        "",
        "unit:",
        "  stage: test",
        `  needs: ${line}`,
        "  script: b",
        "",
      ].join("\n");

    for (const [name, line] of [
      ["an anchor alias", "*shared"],
      ["a !reference", "!reference [.base, needs]"],
    ] as const) {
      test(`${name} returns NEED_NOT_FOUND / notLocal, file intact`, () => {
        const text = sharedList(line);
        // The need *is* effective: otherwise the refusal would come from the previous branch.
        expect(jobOf(text, "unit").needs?.value.map((need) => need.job)).toEqual([
          "compile",
          "lint",
        ]);

        const error = expectUnchanged(
          text,
          { kind: "removeNeed", id: "unit", job: "compile" },
          "NEED_NOT_FOUND",
        );
        expect(error.code === "NEED_NOT_FOUND" ? error.params : null).toEqual({
          reason: "notLocal",
          job: "unit",
          need: "compile",
        });
      });
    }
  });
});
