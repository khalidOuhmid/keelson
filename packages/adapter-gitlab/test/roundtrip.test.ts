import { describe, expect, test } from "bun:test";
import { emit } from "../src/emit.ts";
import { parse } from "../src/parse.ts";
import { corpusFiles, readCorpus } from "./support/corpus.ts";

const files = corpusFiles();

describe("round-trip without operation", () => {
  test("the corpus is not empty", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  for (const file of files) {
    test(`${file.group}/${file.name}: parse then emit returns identical bytes`, () => {
      const text = readCorpus(file);
      expect(emit(parse(text).document)).toBe(text);
    });
  }

  test("CRLF line endings are preserved", () => {
    const text = "stages:\r\n  - test\r\n\r\na:\r\n  script: x\r\n";
    const result = emit(parse(text).document);
    expect(result).toBe(text);
    expect(result).toContain("\r\n");
  });

  test("a file without a final line break is preserved", () => {
    const text = "a:\n  script: x";
    expect(emit(parse(text).document)).toBe(text);
  });

  test("an empty file is preserved", () => {
    expect(emit(parse("").document)).toBe("");
  });

  test("a file made only of comments is preserved", () => {
    const text = "# rien que des commentaires\n# sur deux lignes\n";
    expect(emit(parse(text).document)).toBe(text);
  });

  test("the hash returned by parse is that of the text", () => {
    const text = readCorpus(files[0] ?? { group: "edge-cases", name: "", path: "" });
    const parsed = parse(text);
    expect(parsed.hash).toBe(parsed.document.hash);
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
