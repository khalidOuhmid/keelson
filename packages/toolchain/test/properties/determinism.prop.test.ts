import { describe, expect, test } from "bun:test";
import { hashText, type ToolchainOperation } from "@keelson/core";
import fc from "fast-check";
import { applyToolchain, parseToolchain } from "../../src/index.ts";
import { assertOptions, corpusTexts, operationArb } from "./support/arbitraries.ts";

const scenario = fc
  .constantFrom(...corpusTexts())
  .chain((text) => operationArb(text).map((draft) => ({ text, draft })));

describe("property: same inputs, same outputs", () => {
  test("two identical applications", () => {
    fc.assert(
      fc.property(scenario, ({ text, draft }) => {
        const operation = { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation;
        expect(applyToolchain(text, operation)).toEqual(applyToolchain(text, operation));
      }),
      assertOptions(),
    );
  });

  test("parsing never throws and always returns the same thing", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(parseToolchain(text)).toEqual(parseToolchain(text));
      }),
      assertOptions(),
    );
  });
});
