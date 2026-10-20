import { describe, expect, test } from "bun:test";
import { hashText, type Operation } from "@keelson/core";
import fc from "fast-check";
import { apply } from "../../src/apply.ts";
import { parse } from "../../src/parse.ts";
import { assertOptions, corpusTexts, operationArb } from "./support/arbitraries.ts";

const texts = corpusTexts();

describe("propriété : les octets hors de touched sont inchangés", () => {
  test("le préfixe avant la première plage touchée est intact", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...texts)
          .chain((text) => operationArb(text).map((draft) => ({ text, draft }))),
        ({ text, draft }) => {
          const operation = { v: 1, baseHash: hashText(text), ...draft } as Operation;
          const result = apply(parse(text).document, operation);
          if (!result.ok) {
            return;
          }

          const first = result.value.touched[0];
          if (first === undefined) {
            expect(result.value.text).toBe(text);
            return;
          }

          expect(result.value.text.slice(0, first.start)).toBe(text.slice(0, first.start));
        },
      ),
      assertOptions(),
    );
  });

  test("le suffixe après la dernière plage touchée est intact", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...texts)
          .chain((text) => operationArb(text).map((draft) => ({ text, draft }))),
        ({ text, draft }) => {
          const operation = { v: 1, baseHash: hashText(text), ...draft } as Operation;
          const result = apply(parse(text).document, operation);
          if (!result.ok) {
            return;
          }

          const last = result.value.touched.at(-1);
          if (last === undefined) {
            return;
          }

          const after = result.value.text.slice(last.end);
          expect(text.slice(text.length - after.length)).toBe(after);
        },
      ),
      assertOptions(),
    );
  });

  test("touched décrit exactement du texte présent dans le résultat", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...texts)
          .chain((text) => operationArb(text).map((draft) => ({ text, draft }))),
        ({ text, draft }) => {
          const operation = { v: 1, baseHash: hashText(text), ...draft } as Operation;
          const result = apply(parse(text).document, operation);
          if (!result.ok) {
            return;
          }

          for (const range of result.value.touched) {
            expect(range.start).toBeGreaterThanOrEqual(0);
            expect(range.end).toBeLessThanOrEqual(result.value.text.length);
            expect(range.end).toBeGreaterThanOrEqual(range.start);
          }
        },
      ),
      assertOptions(),
    );
  });
});
