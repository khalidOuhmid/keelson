import { describe, expect, test } from "bun:test";
import { INVALID_OPERATION } from "@keelson/core";
import { expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const trois = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
  "paquet:",
  "  stage: build",
  "  script:",
  "    - pack",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "  script:",
  "    - check",
  "",
].join("\n");

describe("addNeed", () => {
  test("adds an item to an existing needs sequence", () => {
    const applied = expectOk(trois, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("keeps existing items byte for byte", () => {
    const applied = expectOk(trois, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(applied.text).toContain("  needs:\n    - compile\n    - paquet\n");
  });

  test("writes the object form when the need carries options", () => {
    const applied = expectOk(trois, {
      kind: "addNeed",
      id: "unit",
      need: { job: "paquet", optional: true, artifacts: false },
    });
    expect(jobOf(applied.text, "unit").needs?.value).toContainEqual({
      job: "paquet",
      optional: true,
      artifacts: false,
    });
  });

  test("creates the needs key when the job has none", () => {
    const applied = expectOk(trois, { kind: "addNeed", id: "paquet", need: { job: "compile" } });
    expect(jobOf(applied.text, "paquet").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
    ]);
  });

  test("adds into a flow-style sequence", () => {
    const flow = trois.replace("  needs:\n    - compile\n", "  needs: [compile]\n");
    const applied = expectOk(flow, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(applied.text).toContain("needs: [compile, paquet]");
  });

  test("writes a local override when the needs are inherited", () => {
    const herite = [
      ".base:",
      "  needs:",
      "    - compile",
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
      "paquet:",
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
    const applied = expectOk(herite, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    expect(applied.text).toContain(".base:\n  needs:\n    - compile\n");
    const needs = jobOf(applied.text, "unit").needs;
    expect(needs?.origin).toEqual({ kind: "local" });
    expect(needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("accepts an optional need to a missing job", () => {
    const applied = expectOk(trois, {
      kind: "addNeed",
      id: "unit",
      need: { job: "futur", optional: true },
    });
    expect(jobOf(applied.text, "unit").needs?.value).toContainEqual({
      job: "futur",
      optional: true,
      artifacts: true,
    });
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(trois, { kind: "addNeed", id: "unit", need: { job: "paquet" } });
    roundTrip(trois, { kind: "addNeed", id: "paquet", need: { job: "compile" } });
  });

  test("JOB_NOT_FOUND if the job does not exist", () => {
    expectUnchanged(
      trois,
      { kind: "addNeed", id: "absent", need: { job: "compile" } },
      "JOB_NOT_FOUND",
    );
  });

  test("NEED_EXISTS if the need is already present", () => {
    expectUnchanged(
      trois,
      { kind: "addNeed", id: "unit", need: { job: "compile" } },
      "NEED_EXISTS",
    );
  });

  test("CYCLE if the need creates a cycle", () => {
    expectUnchanged(trois, { kind: "addNeed", id: "compile", need: { job: "unit" } }, "CYCLE");
  });

  test("CYCLE for a self-need", () => {
    expectUnchanged(trois, { kind: "addNeed", id: "unit", need: { job: "unit" } }, "CYCLE");
  });
});

describe("addNeed on a shared list", () => {
  /** `needs: *n` became `needs:\n  - c`, which lost a and b; `!reference [.base, needs]` became
   *  `!reference [.base, needs, c]`, a wrong path. No refusal, no diagnostic. */
  const HEAD = "stages:\n  - test\n\n.n: &n\n  - a\n  - b\n\n.base:\n  needs:\n    - a\n\n";
  const JOBS = "a:\n  script: x\nb:\n  script: x\nc:\n  script: x\n";

  for (const [label, value] of [
    ["an anchor alias", "*n"],
    ["a !reference", "!reference [.base, needs]"],
  ] as const) {
    test(`${label} is refused and the text does not change`, () => {
      const text = `${HEAD}${JOBS}unit:\n  stage: test\n  needs: ${value}\n  script: x\n`;
      const error = expectUnchanged(
        text,
        { kind: "addNeed", id: "unit", need: { job: "c" } },
        INVALID_OPERATION,
      );
      expect(error.params).toEqual({ reason: "sharedValue", job: "unit", key: "needs" });
    });
  }
});
