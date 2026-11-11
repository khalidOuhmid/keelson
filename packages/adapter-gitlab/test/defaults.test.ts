import { describe, expect, test } from "bun:test";
import { DEFAULT_STAGE, DEFAULT_STAGES } from "../src/defaults.ts";
import { parse } from "../src/parse.ts";
import { readEdgeCase } from "./support/corpus.ts";

function jobNamed(text: string, id: string) {
  const job = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (job === undefined) {
    throw new Error(`job "${id}" missing from the pipeline`);
  }
  return job;
}

describe("constants", () => {
  test("the default stages are GitLab's", () => {
    expect([...DEFAULT_STAGES]).toEqual([".pre", "build", "test", "deploy", ".post"]);
  });

  test("a job's default stage is test", () => {
    expect(DEFAULT_STAGE).toBe("test");
  });
});

describe("file without a stages key", () => {
  const text = readEdgeCase("no-stages");

  test("materialises the five default stages", () => {
    expect(parse(text).pipeline.stages.map((stage) => stage.name)).toEqual([
      ".pre",
      "build",
      "test",
      "deploy",
      ".post",
    ]);
  });

  test("marks every stage as implicit and without a range", () => {
    for (const stage of parse(text).pipeline.stages) {
      expect(stage.implicit).toBe(true);
      expect(stage.range).toBeNull();
    }
  });

  test("a job without a stage is in test with the default origin", () => {
    const job = jobNamed(text, "sans-stage");
    expect(job.stage.value).toBe("test");
    expect(job.stage.origin).toEqual({ kind: "default" });
  });

  test("a job that declares its stage keeps the local origin", () => {
    const job = jobNamed(text, "avant");
    expect(job.stage.value).toBe(".pre");
    expect(job.stage.origin).toEqual({ kind: "local" });
  });

  test("the reserved .pre and .post stages are usable", () => {
    expect(jobNamed(text, "apres").stage.value).toBe(".post");
  });
});

describe("file with a stages key", () => {
  const text = readEdgeCase("flow-needs");

  test("declared stages are not implicit", () => {
    for (const stage of parse(text).pipeline.stages) {
      expect(stage.implicit).toBe(false);
    }
  });

  test("each declared stage carries a range pointing at its name", () => {
    for (const stage of parse(text).pipeline.stages) {
      expect(stage.range).not.toBeNull();
      if (stage.range !== null) {
        expect(text.slice(stage.range.start, stage.range.end)).toBe(stage.name);
      }
    }
  });

  test("the stage order is the file's", () => {
    expect(parse(text).pipeline.stages.map((stage) => stage.name)).toEqual(["build", "test"]);
  });

  test("a job without a stage stays in test by default even if stages is declared", () => {
    const job = jobNamed("stages:\n  - build\n\nsolo:\n  script: echo\n", "solo");
    expect(job.stage.value).toBe(DEFAULT_STAGE);
    expect(job.stage.origin).toEqual({ kind: "default" });
  });
});
