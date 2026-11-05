import { describe, expect, test } from "bun:test";
import { hashText, type ToolchainOperation } from "@keelson/core";
import fc from "fast-check";
import { applyToolchain } from "../../src/index.ts";
import { assertOptions, corpusTexts, operationArb } from "./support/arbitraries.ts";

const scenario = fc
  .constantFrom(...corpusTexts())
  .chain((text) => operationArb(text).map((draft) => ({ text, draft })));

describe("propriété : les octets hors de touched sont inchangés", () => {
  test("le préfixe et le suffixe sont intacts", () => {
    fc.assert(
      fc.property(scenario, ({ text, draft }) => {
        const operation = { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation;
        const result = applyToolchain(text, operation);
        if (!result.ok) {
          return;
        }

        const range = result.value.touched[0];
        if (range === undefined) {
          expect(result.value.text).toBe(text);
          return;
        }
        expect(result.value.text.slice(0, range.start)).toBe(text.slice(0, range.start));
        const after = result.value.text.slice(range.end);
        expect(text.slice(text.length - after.length)).toBe(after);
      }),
      assertOptions(),
    );
  });

  test("les commentaires hors de l'élément retiré survivent", () => {
    fc.assert(
      fc.property(scenario, ({ text, draft }) => {
        const operation = { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation;
        const result = applyToolchain(text, operation);
        if (!result.ok || draft.kind === "removeService" || draft.kind === "updateService") {
          return;
        }
        for (const line of text.split("\n").filter((entry) => entry.trim().startsWith("#"))) {
          expect(result.value.text).toContain(line);
        }
      }),
      assertOptions(),
    );
  });
});
