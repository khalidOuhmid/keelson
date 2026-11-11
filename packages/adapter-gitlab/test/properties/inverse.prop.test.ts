import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { assertOptions, corpusTexts, operationSequenceArb } from "./support/arbitraries.ts";
import { runSequence, undoAll } from "./support/sequence.ts";

const texts = corpusTexts();

describe("property: a sequence of operations followed by its inverses restores the bytes", () => {
  test("across the whole corpus", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...texts)
          .chain((text) => operationSequenceArb(text).map((drafts) => ({ text, drafts }))),
        ({ text, drafts }) => {
          const run = runSequence(text, drafts);
          expect(undoAll(run)).toBe(text);
        },
      ),
      assertOptions(),
    );
  });

  test("a single operation is always undoable", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...texts)
          .chain((text) => operationSequenceArb(text, 1).map((drafts) => ({ text, drafts }))),
        ({ text, drafts }) => {
          const run = runSequence(text, drafts);
          expect(undoAll(run)).toBe(text);
        },
      ),
      assertOptions(),
    );
  });

  test("the generators do produce accepted operations", () => {
    let accepted = 0;
    fc.assert(
      fc.property(
        fc
          .constantFrom(...texts)
          .chain((text) => operationSequenceArb(text).map((drafts) => ({ text, drafts }))),
        ({ text, drafts }) => {
          accepted += runSequence(text, drafts).accepted;
        },
      ),
      assertOptions(),
    );
    expect(accepted).toBeGreaterThan(0);
  });
});
