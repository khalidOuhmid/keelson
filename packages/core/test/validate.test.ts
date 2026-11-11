import { describe, expect, test } from "bun:test";
import { renderMessage } from "@keelson/core/messages";
import { NEED_LATER_STAGE, NEEDS_CYCLE, UNKNOWN_NEED, UNKNOWN_STAGE } from "../src/diagnostics.ts";
import { validate } from "../src/validate.ts";
import { job, MAIN, need, pipeline, stages } from "./support/pipeline.ts";

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("valid pipeline", () => {
  test("no diagnostic on a healthy pipeline", () => {
    const result = validate(
      pipeline({
        jobs: [job("compile", "build"), job("unit", "test", ["compile"])],
      }),
    );
    expect(result).toEqual([]);
  });

  test("no diagnostic without any needs", () => {
    expect(validate(pipeline({ jobs: [job("a", "build"), job("b", "test")] }))).toEqual([]);
  });

  test("a need on a job of the same stage is accepted", () => {
    expect(validate(pipeline({ jobs: [job("a", "test"), job("b", "test", ["a"])] }))).toEqual([]);
  });

  test("an empty needs list is accepted", () => {
    expect(validate(pipeline({ jobs: [job("a", "build", [])] }))).toEqual([]);
  });
});

describe("UNKNOWN_NEED", () => {
  test("reports a need on a missing job", () => {
    const result = validate(pipeline({ jobs: [job("unit", "test", ["absent"])] }));
    expect(codes(result)).toEqual([UNKNOWN_NEED]);
    expect(result[0]?.severity).toBe("error");
    expect(result[0]?.params).toEqual({ job: "unit", need: "absent" });
  });

  test("reports each missing need separately", () => {
    const result = validate(pipeline({ jobs: [job("unit", "test", ["x", "y"])] }));
    expect(codes(result)).toEqual([UNKNOWN_NEED, UNKNOWN_NEED]);
  });

  test("a need on a template is unknown", () => {
    const result = validate(
      pipeline({
        jobs: [job("unit", "test", [".base"])],
        templates: [{ id: ".base", range: { start: 0, end: 1 }, file: MAIN }],
      }),
    );
    expect(codes(result)).toEqual([UNKNOWN_NEED]);
  });

  test("carries the range of the faulty job", () => {
    const faulty = { ...job("unit", "test", ["absent"]), range: { start: 12, end: 42 } };
    expect(validate(pipeline({ jobs: [faulty] }))[0]?.range).toEqual({ start: 12, end: 42 });
  });
});

describe("NEEDS_CYCLE", () => {
  test("reports a two-job cycle with its path", () => {
    const result = validate(pipeline({ jobs: [job("a", "test", ["b"]), job("b", "test", ["a"])] }));
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
    expect(result[0]?.severity).toBe("error");
    expect(result[0]?.params).toEqual({ cycle: ["a", "b", "a"] });
  });

  test("reports a self-need as a cycle", () => {
    const result = validate(pipeline({ jobs: [job("a", "test", ["a"])] }));
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
    expect(result[0]?.params).toEqual({ cycle: ["a", "a"] });
  });

  test("reports a three-job cycle", () => {
    const result = validate(
      pipeline({
        jobs: [job("a", "test", ["c"]), job("b", "test", ["a"]), job("c", "test", ["b"])],
      }),
    );
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
    expect(result[0]?.params).toEqual({ cycle: ["a", "c", "b", "a"] });
  });

  test("reports a cycle reachable from several entries only once", () => {
    const result = validate(
      pipeline({
        jobs: [
          job("entree1", "test", ["a"]),
          job("entree2", "test", ["b"]),
          job("a", "test", ["b"]),
          job("b", "test", ["a"]),
        ],
      }),
    );
    expect(codes(result)).toEqual([NEEDS_CYCLE]);
  });

  test("reports two disjoint cycles separately", () => {
    const result = validate(
      pipeline({
        jobs: [
          job("a", "test", ["b"]),
          job("b", "test", ["a"]),
          job("c", "test", ["d"]),
          job("d", "test", ["c"]),
        ],
      }),
    );
    expect(codes(result)).toEqual([NEEDS_CYCLE, NEEDS_CYCLE]);
  });

  test("a diamond graph without a cycle triggers nothing", () => {
    const result = validate(
      pipeline({
        jobs: [
          job("a", "build"),
          job("b", "test", ["a"]),
          job("c", "test", ["a"]),
          job("d", "deploy", ["b", "c"]),
        ],
      }),
    );
    expect(result).toEqual([]);
  });
});

describe("UNKNOWN_STAGE", () => {
  test("reports a job in an undeclared stage", () => {
    const result = validate(pipeline({ jobs: [job("unit", "verify")] }));
    expect(codes(result)).toEqual([UNKNOWN_STAGE]);
    expect(result[0]?.severity).toBe("error");
    expect(result[0]?.params).toEqual({ job: "unit", stage: "verify" });
  });

  test("accepts implicit stages", () => {
    const implicit = stages(".pre", "build", "test", "deploy", ".post").map((stage) => ({
      ...stage,
      implicit: true,
    }));
    expect(validate(pipeline({ stages: implicit, jobs: [job("a", ".pre")] }))).toEqual([]);
  });
});

describe("NEED_LATER_STAGE", () => {
  test("reports a need on a job of a later stage", () => {
    const result = validate(
      pipeline({ jobs: [job("compile", "build", ["publish"]), job("publish", "deploy")] }),
    );
    expect(codes(result)).toEqual([NEED_LATER_STAGE]);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.params).toEqual({
      job: "compile",
      stage: "build",
      need: "publish",
      needStage: "deploy",
    });
  });

  test("a need on an earlier stage triggers nothing", () => {
    expect(
      validate(pipeline({ jobs: [job("compile", "build"), job("unit", "test", ["compile"])] })),
    ).toEqual([]);
  });

  test("reports no later stage when the stage itself is unknown", () => {
    const result = validate(pipeline({ jobs: [job("a", "inconnu", ["b"]), job("b", "deploy")] }));
    expect(codes(result)).toEqual([UNKNOWN_STAGE]);
  });
});

describe("determinism and combinations", () => {
  test("two calls on the same pipeline give the same result", () => {
    const input = pipeline({
      jobs: [job("a", "test", ["absent", "b"]), job("b", "build", ["a"])],
    });
    expect(validate(input)).toEqual(validate(input));
  });

  test("diagnostics follow job order", () => {
    const result = validate(
      pipeline({ jobs: [job("premier", "inconnu1"), job("second", "inconnu2")] }),
    );
    expect(result.map((diagnostic) => renderMessage(diagnostic).includes("premier"))).toEqual([
      true,
      false,
    ]);
  });

  test("needs in object form are treated like strings", () => {
    const result = validate(
      pipeline({ jobs: [job("unit", "test", [need("absent", { optional: true })])] }),
    );
    expect(codes(result)).toEqual([UNKNOWN_NEED]);
  });
});
