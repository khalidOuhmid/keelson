import { describe, expect, test } from "bun:test";
import type { ApiFailure } from "../../src/api/client.ts";
import {
  addJob,
  addNeed,
  addStage,
  moveStage,
  referencedBy,
  removeJob,
  removeNeed,
  renameJob,
  scriptLines,
  setEnvironment,
  setJobStage,
} from "../../src/editing/drafts.ts";

describe("scriptLines", () => {
  test("splits on newlines", () => {
    expect(scriptLines("npm ci\nnpm test")).toEqual(["npm ci", "npm test"]);
  });

  test("removes empty lines and trailing whitespace", () => {
    expect(scriptLines("  npm ci  \n\n\n  npm test\n")).toEqual(["npm ci", "npm test"]);
  });

  test("accepts CRLF line endings", () => {
    expect(scriptLines("npm ci\r\nnpm test")).toEqual(["npm ci", "npm test"]);
  });

  test("an empty text yields an empty list", () => {
    expect(scriptLines("   \n  \n")).toEqual([]);
  });

  test("leaves inner whitespace alone", () => {
    expect(scriptLines("echo  'two  spaces'")).toEqual(["echo  'two  spaces'"]);
  });
});

describe("addJob", () => {
  test("builds the operation with the split script", () => {
    expect(addJob({ id: "unit", stage: "test", script: "npm ci\nnpm test" })).toEqual({
      kind: "addJob",
      job: { id: "unit", stage: "test", script: ["npm ci", "npm test"] },
    });
  });

  test("adds no needs key when there are none", () => {
    const draft = addJob({ id: "unit", stage: "test", script: "x" });
    expect("needs" in (draft as { job: object }).job).toBe(false);
  });

  test("carries the requested needs", () => {
    const draft = addJob({ id: "unit", stage: "test", script: "x", needs: ["compile"] });
    expect(draft).toEqual({
      kind: "addJob",
      job: { id: "unit", stage: "test", script: ["x"], needs: [{ job: "compile" }] },
    });
  });

  test("carries the requested environment", () => {
    const draft = addJob({
      id: "ship",
      stage: "deploy",
      script: "x",
      environment: { name: "production" },
    });
    expect(draft).toEqual({
      kind: "addJob",
      job: {
        id: "ship",
        stage: "deploy",
        script: ["x"],
        environment: { name: "production" },
      },
    });
  });

  test("lets an empty id through: legality is the server's call", () => {
    expect(addJob({ id: "", stage: "test", script: "x" })).toEqual({
      kind: "addJob",
      job: { id: "", stage: "test", script: ["x"] },
    });
  });
});

describe("job operations", () => {
  test("renameJob", () => {
    expect(renameJob("unit", "tests")).toEqual({ kind: "renameJob", from: "unit", to: "tests" });
  });

  test("removeJob", () => {
    expect(removeJob("unit")).toEqual({ kind: "removeJob", id: "unit" });
  });

  test("setJobStage", () => {
    expect(setJobStage("unit", "verify")).toEqual({
      kind: "setJobStage",
      id: "unit",
      stage: "verify",
    });
  });
});

describe("needs operations", () => {
  test("addNeed without options writes only the job", () => {
    expect(addNeed("unit", "compile")).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile" },
    });
  });

  test("addNeed carries optional when requested", () => {
    expect(addNeed("unit", "compile", { optional: true })).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile", optional: true },
    });
  });

  test("addNeed carries artifacts when disabled", () => {
    expect(addNeed("unit", "compile", { artifacts: false })).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile", artifacts: false },
    });
  });

  test("addNeed does not write default values", () => {
    expect(addNeed("unit", "compile", { optional: false, artifacts: true })).toEqual({
      kind: "addNeed",
      id: "unit",
      need: { job: "compile" },
    });
  });

  test("removeNeed", () => {
    expect(removeNeed("unit", "compile")).toEqual({
      kind: "removeNeed",
      id: "unit",
      job: "compile",
    });
  });
});

describe("environment", () => {
  test("setEnvironment with a name only", () => {
    expect(setEnvironment("ship", { name: "production" })).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: { name: "production" },
    });
  });

  test("setEnvironment with url and action", () => {
    expect(
      setEnvironment("ship", { name: "staging", url: "https://s.example.org", action: "start" }),
    ).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: { name: "staging", url: "https://s.example.org", action: "start" },
    });
  });

  test("setEnvironment ignores empty fields rather than writing an empty string", () => {
    expect(setEnvironment("ship", { name: "staging", url: "", action: "  " })).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: { name: "staging" },
    });
  });

  test("setEnvironment with null removes the environment", () => {
    expect(setEnvironment("ship", null)).toEqual({
      kind: "setEnvironment",
      id: "ship",
      environment: null,
    });
  });
});

describe("stage operations", () => {
  test("addStage without index", () => {
    expect(addStage("verify")).toEqual({ kind: "addStage", name: "verify" });
  });

  test("addStage with index", () => {
    expect(addStage("verify", 1)).toEqual({ kind: "addStage", name: "verify", index: 1 });
  });

  test("addStage accepts index zero", () => {
    expect(addStage("prepare", 0)).toEqual({ kind: "addStage", name: "prepare", index: 0 });
  });

  test("moveStage", () => {
    expect(moveStage("deploy", 0)).toEqual({ kind: "moveStage", name: "deploy", toIndex: 0 });
  });
});

describe("referencedBy", () => {
  /** `params` come from the network: the cast is there to reproduce what a misbehaving server can
   *  send under a code whose type promises better. */
  function failure(params: unknown): ApiFailure {
    return { status: 422, code: "JOB_REFERENCED", params } as ApiFailure;
  }

  test("extracts the list of jobs referencing the target", () => {
    expect(referencedBy(failure({ referencedBy: ["unit", "ship"] }))).toEqual(["unit", "ship"]);
  });

  test("returns an empty list when referencedBy is missing", () => {
    expect(referencedBy(failure({ job: "compile" }))).toEqual([]);
  });

  test("returns an empty list when params have the wrong shape", () => {
    expect(referencedBy(failure({ autre: 1 }))).toEqual([]);
    expect(referencedBy(failure("text"))).toEqual([]);
    expect(referencedBy(failure({ referencedBy: "unit" }))).toEqual([]);
  });

  test("ignores non-string entries", () => {
    expect(referencedBy(failure({ referencedBy: ["unit", 42, null] }))).toEqual(["unit"]);
  });
});
