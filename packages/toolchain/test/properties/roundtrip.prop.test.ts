import { describe, expect, test } from "bun:test";
import { hashText, type ToolchainOperation } from "@keelson/core";
import fc from "fast-check";
import { applyToolchain, parseToolchain } from "../../src/index.ts";
import { assertOptions, corpusTexts, expected, operationArb } from "./support/arbitraries.ts";

const texts = corpusTexts();
const scenario = fc
  .constantFrom(...texts)
  .chain((text) => operationArb(text).map((draft) => ({ text, draft })));

describe("propriété : le texte écrit se relit comme le modèle attendu", () => {
  test("toute opération acceptée", () => {
    fc.assert(
      fc.property(scenario, ({ text, draft }) => {
        const operation = { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation;
        const result = applyToolchain(text, operation);
        if (!result.ok) {
          return;
        }
        const read = parseToolchain(result.value.text);
        expect(read.diagnostics).toEqual([]);
        expect(read.toolchain).toEqual(expected(parseToolchain(text).toolchain, draft));
      }),
      assertOptions(),
    );
  });

  test("une suite d'opérations reste lisible et fidèle", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...texts),
        fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 6 }),
        (start, seeds) => {
          let text = start;
          for (const seed of seeds) {
            const [draft] = fc.sample(operationArb(text), { numRuns: 1, seed });
            if (draft === undefined) {
              continue;
            }
            const result = applyToolchain(text, {
              v: 1,
              baseHash: hashText(text),
              ...draft,
            } as ToolchainOperation);
            if (result.ok) {
              expect(result.value.toolchain).toEqual(
                expected(parseToolchain(text).toolchain, draft),
              );
              text = result.value.text;
            }
          }
          expect(parseToolchain(text).diagnostics).toEqual([]);
        },
      ),
      assertOptions(),
    );
  });
});
