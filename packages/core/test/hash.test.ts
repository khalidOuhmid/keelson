import { describe, expect, test } from "bun:test";
import { hashText } from "../src/hash.ts";

describe("hashText", () => {
  test("rend le SHA-256 hexadécimal minuscule du texte UTF-8", () => {
    expect(hashText("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("hashe les octets UTF-8, pas les unités UTF-16", () => {
    expect(hashText("é")).toBe(hashText("é"));
    expect(hashText("é")).toHaveLength(64);
  });

  test("est stable d'un appel à l'autre", () => {
    expect(hashText("stage: test\n")).toBe(hashText("stage: test\n"));
  });

  test("distingue deux textes proches", () => {
    expect(hashText("a:\n")).not.toBe(hashText("a: \n"));
  });

  test("ne rend que des caractères hexadécimaux minuscules", () => {
    expect(hashText("Keelson")).toMatch(/^[0-9a-f]{64}$/);
  });
});
