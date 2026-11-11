import { describe, expect, test } from "bun:test";
import { applySplices } from "../src/emit.ts";

describe("applySplices", () => {
  test("applies a single splice", () => {
    expect(applySplices("abcdef", [{ start: 1, end: 3, text: "XY" }]).text).toBe("aXYdef");
  });

  test("applies several disjoint splices", () => {
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

  test("orders splices independently of the input order", () => {
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

  test("an insertion at the same offset as a deletion is inserted before it", () => {
    const result = applySplices("abcdef", [
      { start: 2, end: 4, text: "" },
      { start: 2, end: 2, text: "Z" },
    ]);
    expect(result.text).toBe("abZef");
  });

  test("the input order does not change the result for this edge case", () => {
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

  test("an empty list returns the text unchanged", () => {
    const result = applySplices("abcdef", []);
    expect(result.text).toBe("abcdef");
    expect(result.touched).toEqual([]);
  });

  test("throws on genuinely overlapping splices", () => {
    expect(() =>
      applySplices("abcdef", [
        { start: 0, end: 3, text: "" },
        { start: 1, end: 4, text: "" },
      ]),
    ).toThrow(/chevauchants/);
  });

  test("throws on an inverted splice", () => {
    expect(() => applySplices("abcdef", [{ start: 3, end: 1, text: "" }])).toThrow(/inverted/);
  });
});
