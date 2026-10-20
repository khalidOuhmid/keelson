import { describe, expect, test } from "bun:test";
import { emit } from "../src/emit.ts";
import { parse } from "../src/parse.ts";
import { corpusFiles, readCorpus } from "./support/corpus.ts";

const files = corpusFiles();

describe("aller-retour sans opération", () => {
  test("le corpus n'est pas vide", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  for (const file of files) {
    test(`${file.group}/${file.name} : parse puis emit rend des octets identiques`, () => {
      const text = readCorpus(file);
      expect(emit(parse(text).document)).toBe(text);
    });
  }

  test("les fins de ligne CRLF sont préservées", () => {
    const text = "stages:\r\n  - test\r\n\r\na:\r\n  script: x\r\n";
    const result = emit(parse(text).document);
    expect(result).toBe(text);
    expect(result).toContain("\r\n");
  });

  test("un fichier sans retour à la ligne final est préservé", () => {
    const text = "a:\n  script: x";
    expect(emit(parse(text).document)).toBe(text);
  });

  test("un fichier vide est préservé", () => {
    expect(emit(parse("").document)).toBe("");
  });

  test("un fichier qui n'est que des commentaires est préservé", () => {
    const text = "# rien que des commentaires\n# sur deux lignes\n";
    expect(emit(parse(text).document)).toBe(text);
  });

  test("le hash rendu par parse est celui du texte", () => {
    const text = readCorpus(files[0] ?? { group: "edge-cases", name: "", path: "" });
    const parsed = parse(text);
    expect(parsed.hash).toBe(parsed.document.hash);
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
