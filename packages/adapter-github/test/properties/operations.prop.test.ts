import { describe, expect, test } from "bun:test";
import { hashText, type SpliceOperation } from "@keelson/core";
import fc from "fast-check";
import { apply, parse } from "../../src/index.ts";
import {
  assertOptions,
  corpusTexts,
  FILE,
  isExpectedRefusal,
  op,
  operationArb,
  scenario,
} from "./support/arbitraries.ts";

const run = (text: string, draft: Parameters<typeof op>[1]) =>
  apply(parse(text, { file: FILE }).document, op(hashText(text), draft));

describe("GitHub adapter properties", () => {
  test("round-trip: parse returns the text as is, on the whole corpus and on any text", () => {
    for (const text of corpusTexts()) {
      expect(parse(text, { file: FILE }).document.text).toBe(text);
    }
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(parse(text, { file: FILE }).document.text).toBe(text);
      }),
      assertOptions(),
    );
  });

  test("refusals: only those that are an answer", () => {
    fc.assert(
      fc.property(scenario(), ({ text, draft }) => {
        const result = run(text, draft);
        if (!result.ok) {
          expect({ draft, error: result.error, expected: isExpectedRefusal(result.error) }).toEqual(
            { draft, error: result.error, expected: true },
          );
        }
      }),
      assertOptions(),
    );
  });

  test("invertibility: the inverse restores the bytes, and so does reapplying it", () => {
    fc.assert(
      fc.property(scenario(), ({ text, draft }) => {
        const done = run(text, draft);
        if (!done.ok) {
          return;
        }
        const back = apply(
          parse(done.value.text, { file: FILE }).document,
          done.value.inverse as SpliceOperation,
        );
        expect(back.ok && back.value.text).toBe(text);
        if (back.ok) {
          const again = apply(
            parse(text, { file: FILE }).document,
            back.value.inverse as SpliceOperation,
          );
          expect(again.ok && again.value.text).toBe(done.value.text);
        }
      }),
      assertOptions(),
    );
  });

  test("determinism: same inputs, same outputs", () => {
    fc.assert(
      fc.property(scenario(), ({ text, draft }) => {
        const first = run(text, draft);
        const second = run(text, draft);
        expect(first.ok).toBe(second.ok);
        if (first.ok && second.ok) {
          expect(second.value.text).toBe(first.value.text);
          expect(second.value.inverse).toEqual(first.value.inverse);
        }
      }),
      assertOptions(),
    );
  });

  test("locality: bytes outside touched do not move", () => {
    fc.assert(
      fc.property(scenario(), ({ text, draft }) => {
        const result = run(text, draft);
        if (!result.ok) {
          return;
        }
        const first = result.value.touched[0];
        const last = result.value.touched.at(-1);
        if (first === undefined || last === undefined) {
          expect(result.value.text).toBe(text);
          return;
        }
        expect(result.value.text.slice(0, first.start)).toBe(text.slice(0, first.start));
        const after = result.value.text.slice(last.end);
        expect(text.slice(text.length - after.length)).toBe(after);
      }),
      assertOptions(),
    );
  });

  test("a sequence of operations stays readable", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...corpusTexts()),
        fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 5 }),
        (start, seeds) => {
          let text = start;
          for (const seed of seeds) {
            const [draft] = fc.sample(operationArb(text), { numRuns: 1, seed });
            const result = draft === undefined ? null : run(text, draft);
            if (result?.ok) {
              text = result.value.text;
            }
          }
          const yaml = parse(text, { file: FILE }).diagnostics;
          expect(yaml.filter((entry) => entry.code === "INVALID_YAML")).toEqual([]);
        },
      ),
      assertOptions(),
    );
  });
});
