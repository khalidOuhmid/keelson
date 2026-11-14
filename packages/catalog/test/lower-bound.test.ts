import { describe, expect, test } from "bun:test";
import { type Diagnostic, emptyPipeline, type Pipeline } from "@keelson/core";
import { lowerBoundCause, lowerBoundNote } from "../src/index.ts";

const MAIN = ".gitlab-ci.yml";

function unresolved(form: Pipeline["unresolved"][number]["form"]): Pipeline {
  return {
    ...emptyPipeline(MAIN),
    unresolved: [{ form, detail: "x", from: MAIN, range: null }],
  };
}

const INVALID: Diagnostic = {
  code: "INVALID_YAML",
  severity: "error",
  params: { detail: "bad indentation" },
  range: null,
  file: "ci/jobs.yml",
};

describe("why coverage is a lower bound", () => {
  test("a complete, readable pipeline has no cause", () => {
    expect(lowerBoundCause(emptyPipeline(MAIN), [])).toBeNull();
  });

  test("an unresolved include and an unread called workflow are told apart", () => {
    expect(lowerBoundCause(unresolved("template"), [])).toBe("unresolvedInclude");
    expect(lowerBoundCause(unresolved("workflow"), [])).toBe("unresolvedWorkflow");
  });

  test("invalid YAML is the cause it is, even next to an unresolved include", () => {
    expect(lowerBoundCause(unresolved("template"), [INVALID])).toBe("invalidYaml");
    expect(lowerBoundCause(emptyPipeline(MAIN), [INVALID])).toBe("invalidYaml");
  });

  test("each cause is named in the one sentence the CLI and the UI share", () => {
    expect(lowerBoundNote("invalidYaml")).toBe(
      "Coverage is a lower bound: part of the pipeline is not valid YAML, so a layer listed as uncovered may be covered by what Keelson cannot read.",
    );
    expect(lowerBoundNote("unresolvedInclude")).toBe(
      "Coverage is a lower bound: an include could not be resolved, so a layer listed as uncovered may be covered by the jobs it holds.",
    );
    expect(lowerBoundNote("unresolvedWorkflow")).toBe(
      "Coverage is a lower bound: a called workflow could not be read, so a layer listed as uncovered may be covered by its jobs.",
    );
  });
});
