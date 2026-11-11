import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { emit } from "../../src/emit.ts";
import { parse } from "../../src/parse.ts";
import { assertOptions, corpusTexts } from "./support/arbitraries.ts";

describe("property: parse then emit is the identity", () => {
  test("across the whole corpus", () => {
    fc.assert(
      fc.property(fc.constantFrom(...corpusTexts()), (text) => {
        expect(emit(parse(text).document)).toBe(text);
      }),
      assertOptions(),
    );
  });

  test("on arbitrary text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(emit(parse(text).document)).toBe(text);
      }),
      assertOptions(),
    );
  });

  test("on arbitrary YAML built piece by piece", () => {
    const fragment = fc.constantFrom(
      "stages:\n  - build\n",
      "# a comment\n",
      "\n",
      "worker:\n  script:\n    - echo\n",
      "  - misindented café item\n",
      "\r\n",
      "key: value # inline\n",
      "\t tab\n",
      ".tpl: &anchor\n  image: node\n",
    );

    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 8 }), (fragments) => {
        const text = fragments.join("");
        expect(emit(parse(text).document)).toBe(text);
      }),
      assertOptions(),
    );
  });

  test("the hash is stable for the same text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(parse(text).hash).toBe(parse(text).hash);
      }),
      assertOptions(),
    );
  });
});
