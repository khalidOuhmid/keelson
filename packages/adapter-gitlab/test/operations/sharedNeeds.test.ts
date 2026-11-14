import { describe, expect, test } from "bun:test";
import { expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const JOBS = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script: make",
  "",
  "pack:",
  "  stage: build",
  "  script: pack",
  "",
  "lint:",
  "  stage: build",
  "  script: lint",
  "",
].join("\n");

describe("a needs list shared through an anchor", () => {
  const shared = `${JOBS}unit:\n  stage: test\n  needs: &n\n    - compile\n    - pack\n  script: a\n\nz:\n  stage: test\n  needs: *n\n  script: b\n`;

  test("addNeed on the anchored list is refused: the alias would follow", () => {
    const error = expectUnchanged(
      shared,
      { kind: "addNeed", id: "unit", need: { job: "lint" } },
      "INVALID_OPERATION",
    );
    expect(error.params).toEqual({ reason: "sharedValue", job: "unit", key: "needs" });
  });

  test("removeNeed on the anchored list is refused too", () => {
    expectUnchanged(shared, { kind: "removeNeed", id: "unit", job: "pack" }, "INVALID_OPERATION");
  });

  test("an anchored list nothing aliases is still a shared value: refused", () => {
    const alone = shared.replace("  needs: *n\n", "");
    expectUnchanged(alone, { kind: "removeNeed", id: "unit", job: "pack" }, "INVALID_OPERATION");
  });
});

describe("an anchored need item", () => {
  test("removing an item that carries an anchor is refused, even if an earlier one has the name", () => {
    const text = `${JOBS}.k: &k compile\n\nunit:\n  stage: test\n  needs:\n    - pack\n    - &k lint\n  script: a\n\nz:\n  stage: test\n  needs:\n    - *k\n  script: b\n`;
    expectUnchanged(text, { kind: "removeNeed", id: "unit", job: "lint" }, "INVALID_OPERATION");
  });

  test("removing the last item, anchored, is refused as well", () => {
    const text = `${JOBS}.k: &k compile\n\nunit:\n  stage: test\n  needs:\n    - &k lint\n  script: a\n\nz:\n  stage: test\n  needs:\n    - *k\n  script: b\n`;
    expectUnchanged(text, { kind: "removeNeed", id: "unit", job: "lint" }, "INVALID_OPERATION");
  });

  test("an unanchored item next to it can still be removed", () => {
    const text = `${JOBS}unit:\n  stage: test\n  needs:\n    - pack\n    - &k lint\n  script: a\n\nz:\n  stage: test\n  needs:\n    - *k\n  script: b\n`;
    const applied = expectOk(text, { kind: "removeNeed", id: "unit", job: "pack" });
    expect(applied.text).toContain("  needs:\n    - &k lint\n");
    expect(applied.text).toContain("    - *k\n");
  });
});

describe("a flow list receiving a need with options", () => {
  const flow = `${JOBS}unit:\n  stage: test\n  needs: [compile]\n  script: a\n`;

  test("the item is written in flow form with its options", () => {
    const applied = expectOk(flow, {
      kind: "addNeed",
      id: "unit",
      need: { job: "pack", optional: true, artifacts: false },
    });
    expect(applied.text).toContain(
      "needs: [compile, { job: pack, optional: true, artifacts: false }]",
    );
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
      { job: "pack", optional: true, artifacts: false },
    ]);
  });

  test("an empty flow list receives the item with its options", () => {
    const empty = flow.replace("[compile]", "[]");
    const applied = expectOk(empty, {
      kind: "addNeed",
      id: "unit",
      need: { job: "pack", optional: true },
    });
    expect(jobOf(applied.text, "unit").needs?.value).toEqual([
      { job: "pack", optional: true, artifacts: true },
    ]);
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(flow, { kind: "addNeed", id: "unit", need: { job: "pack", optional: true } });
  });
});
