import { describe, expect, test } from "bun:test";
import { parse } from "../src/parse.ts";
import { expectError } from "./support/apply.ts";

const TEXT = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script: make",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "    - project: group/upstream",
  "      job: package",
  "      ref: main",
  "      artifacts: true",
  "  script: test",
  "",
].join("\n");

function job(text: string, id: string) {
  const found = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`job "${id}" missing`);
  }
  return found;
}

describe("a cross-project need", () => {
  test("the modelled needs keep the local job only", () => {
    expect(job(TEXT, "unit").needs?.value.map((need) => need.job)).toEqual(["compile"]);
  });

  test("the whole needs list is shown verbatim as an opaque block", () => {
    const block = job(TEXT, "unit").opaque.find((entry) => entry.key === "needs");
    expect(block?.file).toBe(".gitlab-ci.yml");
    expect(block).toBeDefined();
    const slice = TEXT.slice(block?.range.start, block?.range.end);
    expect(slice).toContain("project: group/upstream");
    expect(slice).toContain("- compile");
  });

  test("the block comes from the template that carries the list", () => {
    const inherited = TEXT.replace("unit:\n  stage: test\n  needs:", ".tpl:\n  needs:").replace(
      "  script: test\n",
      "\nunit:\n  extends: .tpl\n  stage: test\n  script: test\n",
    );
    const block = job(inherited, "unit").opaque.find((entry) => entry.key === "needs");
    expect(block).toBeDefined();
    expect(inherited.slice(block?.range.start, block?.range.end)).toContain(
      "project: group/upstream",
    );
  });

  test("a job whose needs are all modelled has no needs block", () => {
    expect(job(TEXT, "compile").opaque.map((entry) => entry.key)).toEqual(["script"]);
    const plain = TEXT.replace(/ {4}- project[\s\S]*artifacts: true\n/, "");
    expect(job(plain, "unit").opaque.map((entry) => entry.key)).toEqual(["script"]);
  });

  test("removing a need names a job of this pipeline: the cross-project item is not one", () => {
    const error = expectError(
      TEXT,
      { kind: "removeNeed", id: "unit", job: "package" },
      "NEED_NOT_FOUND",
    );
    expect(error.params).toEqual({ reason: "notNeeded", job: "unit", need: "package" });
  });

  test("the job still says its list carries unmodelled items, so no rewrite loses them", () => {
    const parsed = parse(TEXT);
    expect(parsed.pipeline.jobs.find((entry) => entry.id === "unit")?.unmodelledNeeds).toBe(true);
  });
});
