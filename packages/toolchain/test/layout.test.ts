import { describe, expect, test } from "bun:test";
import { emptyPipeline, type Job, type Pipeline } from "@keelson/core";
import { LAYOUT_FILE, parseLayout, parsePositions, writePositions } from "../src/index.ts";

const PIPELINE = emptyPipeline(".gitlab-ci.yml");

function pipeline(ids: string[]): Pipeline {
  return { ...emptyPipeline(".gitlab-ci.yml"), jobs: ids.map((id) => ({ id }) as Job) };
}

const parsed = (value: unknown, ids = ["unit"]) =>
  parseLayout(JSON.stringify(value), pipeline(ids));

describe("layout.json", () => {
  test("a missing file is the normal case: nothing to report", () => {
    expect(parseLayout(null, pipeline([]))).toEqual({
      overrides: {},
      positions: {},
      diagnostics: [],
    });
  });

  test("an override is read, and an empty list is still an override", () => {
    const result = parsed({ version: 1, layers: { unit: ["sast"], lint: [] } }, ["unit", "lint"]);
    expect(result.overrides).toEqual({ unit: ["sast"], lint: [] });
    expect(result.diagnostics).toEqual([]);
  });

  test("milestone L4 positions do not get in the way", () => {
    expect(parsed({ version: 1, positions: {} }).diagnostics).toEqual([]);
  });

  test("unreadable JSON is reported and ignored, with the file path", () => {
    const result = parseLayout("{", pipeline([]));
    expect(result.overrides).toEqual({});
    expect(result.diagnostics[0]).toMatchObject({
      code: "LAYOUT_INVALID",
      severity: "warning",
      file: LAYOUT_FILE,
      range: null,
    });
  });

  test("an unknown version is rejected as a whole", () => {
    expect(parsed({ version: 2, layers: { unit: ["sast"] } }).overrides).toEqual({});
    expect(parsed({ version: 2 }).diagnostics[0]?.code).toBe("LAYOUT_INVALID");
  });

  test("an unknown layer is reported, the others apply", () => {
    const result = parsed({ version: 1, layers: { unit: ["sast", "inventee"] } });
    expect(result.overrides).toEqual({ unit: ["sast"] });
    expect(result.diagnostics.map((entry) => entry.params)).toEqual([
      { job: "unit", layer: "inventee" },
    ]);
  });

  test("an unknown job is reported and produces no override", () => {
    const result = parsed({ version: 1, layers: { absent: ["sast"] } });
    expect(result.overrides).toEqual({});
    expect(result.diagnostics[0]?.code).toBe("LAYOUT_UNKNOWN_JOB");
  });
});

describe("positions", () => {
  test("read from layout.json", () => {
    const { positions } = parseLayout(
      '{"version":1,"positions":{"service:nexus":{"x":10,"y":-4.5}}}',
      PIPELINE,
    );
    expect(positions).toEqual({ "service:nexus": { x: 10, y: -4.5 } });
  });

  test("missing, or with an invalid file, yield an empty table", () => {
    expect(parseLayout(null, PIPELINE).positions).toEqual({});
    expect(parseLayout("{", PIPELINE).positions).toEqual({});
  });

  test("writing keeps sibling keys and sorts the nodes", () => {
    const written = writePositions('{"version":1,"layers":{"a":["sast"]},"autre":true}', {
      b: { x: 1, y: 2 },
      a: { x: 0, y: 0 },
    });
    expect(written).toBe(
      `${JSON.stringify(
        {
          version: 1,
          layers: { a: ["sast"] },
          autre: true,
          positions: { a: { x: 0, y: 0 }, b: { x: 1, y: 2 } },
        },
        null,
        2,
      )}\n`,
    );
  });

  test("writing merges with the positions already there", () => {
    const written = writePositions('{"version":1,"positions":{"a":{"x":1,"y":1}}}', {
      b: { x: 2, y: 2 },
    });
    expect(JSON.parse(written ?? "").positions).toEqual({
      a: { x: 1, y: 1 },
      b: { x: 2, y: 2 },
    });
  });

  test("writing creates the missing file", () => {
    expect(JSON.parse(writePositions(null, {}) ?? "")).toEqual({ version: 1, positions: {} });
  });

  test("an unreadable file is not overwritten", () => {
    expect(writePositions("{", {})).toBeNull();
    expect(writePositions("[]", {})).toBeNull();
    expect(writePositions('{"version":2}', {})).toBeNull();
  });
});

describe("a `__proto__` key", () => {
  const PROTO = '{"version":1,"positions":{"__proto__":{"x":1,"y":2},"a":{"x":3,"y":4}}}';

  test("is a position like any other", () => {
    const { positions } = parseLayout(PROTO, PIPELINE);
    expect(Object.getPrototypeOf(positions)).toBe(Object.prototype);
    expect(Object.keys(positions)).toEqual(["__proto__", "a"]);
    expect(Object.getOwnPropertyDescriptor(positions, "__proto__")?.value).toEqual({ x: 1, y: 2 });
  });

  test("is checked like any other", () => {
    const text = '{"version":1,"positions":{"__proto__":{"x":"left","y":2}}}';
    expect(parseLayout(text, PIPELINE).diagnostics[0]?.code).toBe("LAYOUT_INVALID");
    expect(parsePositions(JSON.parse('{"__proto__":{"x":1}}')).ok).toBe(false);
  });

  test("survives a write", () => {
    const written = writePositions(PROTO, { b: { x: 0, y: 0 } }) ?? "";
    expect(Object.keys(JSON.parse(written).positions)).toEqual(["__proto__", "a", "b"]);
  });

  test("is an override for a job of that name", () => {
    const text = '{"version":1,"layers":{"__proto__":["sast"]}}';
    const result = parseLayout(text, pipeline(["__proto__"]));
    expect(Object.getPrototypeOf(result.overrides)).toBe(Object.prototype);
    expect(Object.keys(result.overrides)).toEqual(["__proto__"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("of an unknown job is reported", () => {
    const result = parseLayout('{"version":1,"layers":{"__proto__":["sast"]}}', PIPELINE);
    expect(result.diagnostics[0]?.code).toBe("LAYOUT_UNKNOWN_JOB");
  });
});
