import { describe, expect, test } from "bun:test";
import { hashText, type ToolchainOperation } from "@keelson/core";
import fc from "fast-check";
import { applyToolchain } from "../../src/index.ts";
import { assertOptions, corpusTexts, operationArb } from "./support/arbitraries.ts";

const scenario = fc
  .constantFrom(...corpusTexts())
  .chain((text) => operationArb(text).map((draft) => ({ text, draft })));

describe("propriété : l'inverse restaure les octets", () => {
  test("appliquer puis annuler, annuler l'annulation", () => {
    fc.assert(
      fc.property(scenario, ({ text, draft }) => {
        const operation = { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation;
        const done = applyToolchain(text, operation);
        if (!done.ok) {
          return;
        }

        const undone = applyToolchain(done.value.text, done.value.inverse);
        expect(undone.ok && undone.value.text).toBe(text);
        if (undone.ok) {
          const redone = applyToolchain(text, undone.value.inverse);
          expect(redone.ok && redone.value.text).toBe(done.value.text);
        }
      }),
      assertOptions(),
    );
  });
});
