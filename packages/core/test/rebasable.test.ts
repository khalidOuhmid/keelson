import { describe, expect, test } from "bun:test";
import {
  INVALID_OPERATION,
  operationSchema,
  parseOperation,
  parseRebasableOperation,
  parseRebasableToolchainOperation,
  parseToolchainOperation,
  toolchainOperationSchema,
} from "../src/index.ts";

const HASH = "a".repeat(64);

const CI_SAMPLES: Record<string, Record<string, unknown>> = {
  addJob: { kind: "addJob", job: { id: "unit", stage: "test", script: ["t"] } },
  removeJob: { kind: "removeJob", id: "unit" },
  renameJob: { kind: "renameJob", from: "a", to: "b" },
  setJobStage: { kind: "setJobStage", id: "unit", stage: "test" },
  addNeed: { kind: "addNeed", id: "unit", need: { job: "build" } },
  removeNeed: { kind: "removeNeed", id: "unit", job: "build" },
  setEnvironment: { kind: "setEnvironment", id: "unit", environment: null },
  addStage: { kind: "addStage", name: "deploy" },
  moveStage: { kind: "moveStage", name: "deploy", toIndex: 0 },
  splice: { kind: "splice", start: 0, end: 0, text: "" },
  addSnippet: { kind: "addSnippet", id: "x", stage: "test", snippet: "x:\n  script: [t]\n" },
  composite: { kind: "composite", steps: [{ kind: "addStage", name: "deploy" }] },
};

const TOOLCHAIN_SAMPLES: Record<string, Record<string, unknown>> = {
  addService: { kind: "addService", id: "n", tool: "nexus", url: null, environment: null },
  updateService: { kind: "updateService", id: "n", tool: "nexus" },
  removeService: { kind: "removeService", id: "n" },
  addIntegration: { kind: "addIntegration", job: "j", service: "n", integration: "push" },
  removeIntegration: { kind: "removeIntegration", job: "j", service: "n", integration: "push" },
  dismissIntegration: { kind: "dismissIntegration", job: "j", tool: "nexus", integration: "push" },
  restoreIntegration: { kind: "restoreIntegration", job: "j", tool: "nexus", integration: "push" },
  splice: { kind: "splice", start: 0, end: 0, text: "" },
};

function kindsOf(schema: { options: readonly { shape: { kind: { value: unknown } } }[] }) {
  return schema.options.map((option) => String(option.shape.kind.value)).sort();
}

describe("the samples cover every kind", () => {
  test("CI operations", () => {
    expect(Object.keys(CI_SAMPLES).sort()).toEqual(kindsOf(operationSchema as never));
  });

  test("toolchain operations", () => {
    expect(Object.keys(TOOLCHAIN_SAMPLES).sort()).toEqual(
      kindsOf(toolchainOperationSchema as never),
    );
  });
});

for (const [family, samples, strict, rebasable] of [
  ["CI", CI_SAMPLES, parseOperation, parseRebasableOperation],
  ["toolchain", TOOLCHAIN_SAMPLES, parseToolchainOperation, parseRebasableToolchainOperation],
] as const) {
  describe(`rebasable ${family} operations`, () => {
    for (const [kind, sample] of Object.entries(samples)) {
      test(`${kind} without baseHash: refused by the strict schema, accepted by the rebasable one`, () => {
        const unanchored = { v: 1, ...sample };
        const refused = strict(unanchored);
        expect(refused.ok).toBe(false);
        if (!refused.ok) {
          expect(refused.error.code).toBe(INVALID_OPERATION);
        }
        const accepted = rebasable(unanchored);
        expect(accepted.ok).toBe(true);
        if (accepted.ok) {
          expect(accepted.value.kind as string).toBe(kind);
          expect("baseHash" in accepted.value).toBe(false);
        }
      });

      test(`${kind} with baseHash: both schemas give the same value`, () => {
        const anchored = { v: 1, baseHash: HASH, ...sample };
        expect(rebasable(anchored)).toEqual(strict(anchored) as never);
      });
    }

    test("a malformed baseHash is still refused", () => {
      const sample = Object.values(samples)[0] as Record<string, unknown>;
      const result = rebasable({ v: 1, baseHash: "not-a-hash", ...sample });
      expect(result.ok).toBe(false);
    });

    test("an unknown key is still refused", () => {
      const sample = Object.values(samples)[0] as Record<string, unknown>;
      expect(rebasable({ v: 1, ...sample, extra: true }).ok).toBe(false);
    });

    test("an unknown version is still refused", () => {
      const sample = Object.values(samples)[0] as Record<string, unknown>;
      const result = rebasable({ v: 2, ...sample });
      expect(result.ok ? null : result.error.code).toBe("UNSUPPORTED_VERSION");
    });
  });
}
