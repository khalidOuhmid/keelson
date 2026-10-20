import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { emit } from "../../src/emit.ts";
import { parse } from "../../src/parse.ts";
import { assertOptions, corpusTexts } from "./support/arbitraries.ts";

describe("propriété : parse puis emit est l'identité", () => {
  test("sur tout le corpus", () => {
    fc.assert(
      fc.property(fc.constantFrom(...corpusTexts()), (text) => {
        expect(emit(parse(text).document)).toBe(text);
      }),
      assertOptions(),
    );
  });

  test("sur du texte quelconque", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(emit(parse(text).document)).toBe(text);
      }),
      assertOptions(),
    );
  });

  test("sur du YAML quelconque construit par morceaux", () => {
    const fragment = fc.constantFrom(
      "stages:\n  - build\n",
      "# un commentaire\n",
      "\n",
      "boulot:\n  script:\n    - echo\n",
      "  - item mal indenté\n",
      "\r\n",
      "cle: valeur # en ligne\n",
      "\t tabulation\n",
      ".tpl: &ancre\n  image: node\n",
    );

    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 8 }), (fragments) => {
        const text = fragments.join("");
        expect(emit(parse(text).document)).toBe(text);
      }),
      assertOptions(),
    );
  });

  test("le hash est stable pour un même texte", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(parse(text).hash).toBe(parse(text).hash);
      }),
      assertOptions(),
    );
  });
});
