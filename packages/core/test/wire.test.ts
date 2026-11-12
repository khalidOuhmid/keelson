import { describe, expect, test } from "bun:test";
import { MESSAGE_CODES } from "../src/messages/codes.ts";
import { diagnosticSchema, PARAMS_SCHEMAS, paramsFit, pipelineSchema } from "../src/wire.ts";
import { job, pipeline, range } from "./support/pipeline.ts";

describe("params at the network boundary", () => {
  test("every code of the registry has a params schema", () => {
    expect(Object.keys(PARAMS_SCHEMAS).sort()).toEqual([...MESSAGE_CODES].sort());
  });

  test("well-formed params fit their code", () => {
    expect(paramsFit("METHOD_NOT_ALLOWED", { method: "PUT" })).toBe(true);
    expect(paramsFit("INVALID_NAME", { reason: "stage" })).toBe(true);
    expect(paramsFit("FORBIDDEN_TOKEN", {})).toBe(true);
  });

  test("partial params do not fit: the sentence would read 'undefined'", () => {
    expect(paramsFit("METHOD_NOT_ALLOWED", {})).toBe(false);
    expect(paramsFit("INVALID_NAME", { reason: "job" })).toBe(false);
    expect(paramsFit("INVALID_NAME", { reason: "elsewhere", name: "x" })).toBe(false);
    expect(paramsFit("UNSUPPORTED_VERSION", { received: "2", supported: 1 })).toBe(false);
    expect(paramsFit("INCLUDE_CYCLE", { trail: "a" })).toBe(false);
  });
});

describe("a diagnostic from the network", () => {
  const valid = {
    code: "UNKNOWN_NEED",
    severity: "error",
    params: { job: "unit", need: "build" },
    range: { start: 0, end: 4 },
    file: ".gitlab-ci.yml",
  };

  test("a well-formed diagnostic parses", () => {
    expect(diagnosticSchema.safeParse(valid).success).toBe(true);
  });

  test("an unknown code, a missing file or partial params are refused", () => {
    expect(diagnosticSchema.safeParse({ ...valid, code: "NOPE" }).success).toBe(false);
    expect(diagnosticSchema.safeParse({ ...valid, file: undefined }).success).toBe(false);
    expect(diagnosticSchema.safeParse({ ...valid, params: { job: "unit" } }).success).toBe(false);
    expect(diagnosticSchema.safeParse({ ...valid, code: "STALE_DOCUMENT" }).success).toBe(false);
  });
});

describe("a pipeline from the network", () => {
  test("the IR parses as is", () => {
    const shown = pipeline({ jobs: [job("unit", "test", ["build"]), job("build", "build")] });
    expect(pipelineSchema.parse(shown)).toEqual(shown);
  });

  test("a job without a stage or with a string range is refused", () => {
    const broken = pipeline({ jobs: [job("unit", "test")] });
    const withoutStage = { ...broken, jobs: [{ ...broken.jobs[0], stage: undefined }] };
    const stringRange = { ...broken, jobs: [{ ...broken.jobs[0], range: "0-4" }] };
    expect(pipelineSchema.safeParse(withoutStage).success).toBe(false);
    expect(pipelineSchema.safeParse(stringRange).success).toBe(false);
    expect(pipelineSchema.safeParse({ ...broken, jobs: null }).success).toBe(false);
    expect(
      pipelineSchema.safeParse({ ...broken, templates: [{ id: ".t", range: range() }] }).success,
    ).toBe(false);
  });
});
