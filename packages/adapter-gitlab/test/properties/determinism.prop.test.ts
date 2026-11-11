import { describe, expect, test } from "bun:test";
import { hashText, type Operation } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import fc from "fast-check";
import { apply } from "../../src/apply.ts";
import { parse } from "../../src/parse.ts";
import { assertOptions, corpusTexts, operationArb } from "./support/arbitraries.ts";

const texts = corpusTexts();

describe("property: two identical applications yield identical outputs", () => {
  test("same text, same hash, same touched ranges", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...texts)
          .chain((text) => operationArb(text).map((draft) => ({ text, draft }))),
        ({ text, draft }) => {
          const operation = { v: 1, baseHash: hashText(text), ...draft } as Operation;
          const first = apply(parse(text).document, operation);
          const second = apply(parse(text).document, operation);

          expect(first.ok).toBe(second.ok);
          if (first.ok && second.ok) {
            expect(second.value.text).toBe(first.value.text);
            expect(second.value.hash).toBe(first.value.hash);
            expect(second.value.touched).toEqual(first.value.touched);
            expect(second.value.inverse).toEqual(first.value.inverse);
          }
          if (!first.ok && !second.ok) {
            expect(second.error.code).toBe(first.error.code);
            expect(renderMessage(second.error)).toBe(renderMessage(first.error));
          }
        },
      ),
      assertOptions(),
    );
  });

  test("parsing is deterministic", () => {
    fc.assert(
      fc.property(fc.constantFrom(...texts), (text) => {
        const first = parse(text);
        const second = parse(text);
        expect(JSON.parse(JSON.stringify(second.pipeline))).toEqual(
          JSON.parse(JSON.stringify(first.pipeline)),
        );
        expect(second.diagnostics).toEqual(first.diagnostics);
      }),
      assertOptions(),
    );
  });
});
