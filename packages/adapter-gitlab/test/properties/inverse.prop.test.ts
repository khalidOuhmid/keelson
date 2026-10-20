import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { assertOptions, corpusTexts, operationSequenceArb } from "./support/arbitraries.ts";
import { runSequence, undoAll } from "./support/sequence.ts";

const texts = corpusTexts();

describe("propriété : une séquence d'opérations puis ses inverses restaure les octets", () => {
  test("sur tout le corpus", () => {
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

  test("une opération seule est toujours annulable", () => {
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

  test("les générateurs produisent bien des opérations acceptées", () => {
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
