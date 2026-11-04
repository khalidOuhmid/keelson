import { describe, expect, test } from "bun:test";
import { hashText, type ToolchainOperation } from "@keelson/core";
import fc from "fast-check";
import { applyToolchain, parseToolchain } from "../../src/index.ts";
import { assertOptions, corpusTexts, operationArb } from "./support/arbitraries.ts";

const scenario = fc
  .constantFrom(...corpusTexts())
  .chain((text) => operationArb(text).map((draft) => ({ text, draft })));

describe("propriété : mêmes entrées, mêmes sorties", () => {
  test("deux applications identiques", () => {
    fc.assert(
      fc.property(scenario, ({ text, draft }) => {
        const operation = { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation;
        expect(applyToolchain(text, operation)).toEqual(applyToolchain(text, operation));
      }),
      assertOptions(),
    );
  });

  test("le parsing ne lève jamais et rend toujours la même chose", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(parseToolchain(text)).toEqual(parseToolchain(text));
      }),
      assertOptions(),
    );
  });
});
