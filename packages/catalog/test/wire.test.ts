import { describe, expect, test } from "bun:test";
import type { Coverage } from "../src/coverage.ts";
import { coverageSchema } from "../src/wire.ts";

const COVERAGE: Coverage = {
  jobs: [{ job: "sast", layers: ["sast"], tools: ["semgrep"], overridden: false }],
  layers: [{ layer: "sast", covered: true, jobs: ["sast"], services: [], ci: ["gitlab-ci"] }],
  partial: false,
};

describe("coverage from the network", () => {
  test("a computed coverage parses as is", () => {
    expect(coverageSchema.parse(COVERAGE)).toEqual(COVERAGE);
  });

  test("an unknown layer, a missing flag or a foreign CI system is refused", () => {
    const unknownLayer = { ...COVERAGE, layers: [{ ...COVERAGE.layers[0], layer: "magic" }] };
    const foreignCi = { ...COVERAGE, layers: [{ ...COVERAGE.layers[0], ci: ["jenkins"] }] };
    expect(coverageSchema.safeParse(unknownLayer).success).toBe(false);
    expect(coverageSchema.safeParse({ jobs: [], layers: [] }).success).toBe(false);
    expect(coverageSchema.safeParse(foreignCi).success).toBe(false);
  });
});
