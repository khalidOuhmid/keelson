import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("splice", () => {
  test("replaces exactly the requested range", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "STAGES" });
    expect(applied.text).toStartWith("STAGES:");
    expect(applied.text.slice(6)).toBe(BASE.slice(6));
  });

  test("a pure insertion has start equal to end", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 0, text: "# head\n" });
    expect(applied.text).toBe(`# head\n${BASE}`);
  });

  test("a pure deletion has an empty text", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 10, text: "" });
    expect(applied.text).toBe(BASE.slice(10));
  });

  test("touched describes the range written in the new text", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "ST" });
    expect(applied.touched).toEqual([{ start: 0, end: 2 }]);
    expect(applied.text.slice(0, 2)).toBe("ST");
  });

  test("the returned hash is that of the new text", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "ST" });
    expect(applied.hash).toBe(applied.document.hash);
    expect(applied.hash).not.toBe(BASE);
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(BASE, { kind: "splice", start: 0, end: 6, text: "STAGES" });
    roundTrip(BASE, { kind: "splice", start: 5, end: 5, text: "\n# inserted\n" });
  });

  test("the inverse carries the hash of the new text", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "ST" });
    expect(applied.inverse.baseHash).toBe(applied.hash);
    expect(applied.inverse.v).toBe(1);
    expect(applied.inverse.kind).toBe("splice");
  });

  test("RANGE_OUT_OF_BOUNDS if end is past the end of the text", () => {
    expectUnchanged(
      BASE,
      { kind: "splice", start: 0, end: BASE.length + 1, text: "" },
      "RANGE_OUT_OF_BOUNDS",
    );
  });

  test("RANGE_OUT_OF_BOUNDS if start is past end", () => {
    expectUnchanged(BASE, { kind: "splice", start: 10, end: 5, text: "" }, "RANGE_OUT_OF_BOUNDS");
  });

  test("RANGE_OUT_OF_BOUNDS if start is past the end of the text", () => {
    expectUnchanged(
      BASE,
      { kind: "splice", start: BASE.length + 5, end: BASE.length + 5, text: "x" },
      "RANGE_OUT_OF_BOUNDS",
    );
  });

  test("a splice at the very end of the text is accepted", () => {
    const applied = expectOk(BASE, {
      kind: "splice",
      start: BASE.length,
      end: BASE.length,
      text: "# end\n",
    });
    expect(applied.text).toBe(`${BASE}# end\n`);
  });

  test("STALE_DOCUMENT if the baseHash does not match", () => {
    const { apply } = require("../../src/apply.ts");
    const { parse } = require("../../src/parse.ts");
    const result = apply(parse(BASE).document, {
      v: 1,
      baseHash: "b".repeat(64),
      kind: "splice",
      start: 0,
      end: 1,
      text: "x",
    });
    expect(result.ok).toBe(false);
  });
});
