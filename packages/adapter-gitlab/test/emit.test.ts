import { describe, expect, test } from "bun:test";
import { applySplices } from "../src/emit.ts";

describe("applySplices", () => {
  test("applique un splice unique", () => {
    expect(applySplices("abcdef", [{ start: 1, end: 3, text: "XY" }]).text).toBe("aXYdef");
  });

  test("applique plusieurs splices disjoints", () => {
    const result = applySplices("abcdef", [
      { start: 0, end: 1, text: "A" },
      { start: 4, end: 5, text: "E" },
    ]);
    expect(result.text).toBe("AbcdEf");
    expect(result.touched).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 5 },
    ]);
  });

  test("ordonne les splices indépendamment de l'ordre d'entrée", () => {
    const croissant = applySplices("abcdef", [
      { start: 0, end: 1, text: "A" },
      { start: 4, end: 5, text: "E" },
    ]);
    const decroissant = applySplices("abcdef", [
      { start: 4, end: 5, text: "E" },
      { start: 0, end: 1, text: "A" },
    ]);
    expect(decroissant).toEqual(croissant);
  });

  test("une insertion au même offset qu'une suppression est insérée avant", () => {
    const result = applySplices("abcdef", [
      { start: 2, end: 4, text: "" },
      { start: 2, end: 2, text: "Z" },
    ]);
    expect(result.text).toBe("abZef");
  });

  test("l'ordre d'entrée ne change pas le résultat pour ce cas limite", () => {
    const sens1 = applySplices("abcdef", [
      { start: 2, end: 4, text: "" },
      { start: 2, end: 2, text: "Z" },
    ]);
    const sens2 = applySplices("abcdef", [
      { start: 2, end: 2, text: "Z" },
      { start: 2, end: 4, text: "" },
    ]);
    expect(sens2).toEqual(sens1);
  });

  test("une liste vide rend le texte inchangé", () => {
    const result = applySplices("abcdef", []);
    expect(result.text).toBe("abcdef");
    expect(result.touched).toEqual([]);
  });

  test("lève sur des splices réellement chevauchants", () => {
    expect(() =>
      applySplices("abcdef", [
        { start: 0, end: 3, text: "" },
        { start: 1, end: 4, text: "" },
      ]),
    ).toThrow(/chevauchants/);
  });

  test("lève sur un splice inversé", () => {
    expect(() => applySplices("abcdef", [{ start: 3, end: 1, text: "" }])).toThrow(/inverted/);
  });
});
