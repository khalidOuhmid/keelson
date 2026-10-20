import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, roundTrip } from "../support/apply.ts";

describe("splice", () => {
  test("remplace exactement la plage demandée", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "STAGES" });
    expect(applied.text).toStartWith("STAGES:");
    expect(applied.text.slice(6)).toBe(BASE.slice(6));
  });

  test("une insertion pure a start égal à end", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 0, text: "# tête\n" });
    expect(applied.text).toBe(`# tête\n${BASE}`);
  });

  test("une suppression pure a un texte vide", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 10, text: "" });
    expect(applied.text).toBe(BASE.slice(10));
  });

  test("touched décrit la plage écrite dans le nouveau texte", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "ST" });
    expect(applied.touched).toEqual([{ start: 0, end: 2 }]);
    expect(applied.text.slice(0, 2)).toBe("ST");
  });

  test("le hash rendu est celui du nouveau texte", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "ST" });
    expect(applied.hash).toBe(applied.document.hash);
    expect(applied.hash).not.toBe(BASE);
  });

  test("l'inverse restaure les octets d'origine", () => {
    roundTrip(BASE, { kind: "splice", start: 0, end: 6, text: "STAGES" });
    roundTrip(BASE, { kind: "splice", start: 5, end: 5, text: "\n# insere\n" });
  });

  test("l'inverse porte le hash du nouveau texte", () => {
    const applied = expectOk(BASE, { kind: "splice", start: 0, end: 6, text: "ST" });
    expect(applied.inverse.baseHash).toBe(applied.hash);
    expect(applied.inverse.v).toBe(1);
    expect(applied.inverse.kind).toBe("splice");
  });

  test("RANGE_OUT_OF_BOUNDS si end dépasse la fin du texte", () => {
    expectUnchanged(
      BASE,
      { kind: "splice", start: 0, end: BASE.length + 1, text: "" },
      "RANGE_OUT_OF_BOUNDS",
    );
  });

  test("RANGE_OUT_OF_BOUNDS si start dépasse end", () => {
    expectUnchanged(BASE, { kind: "splice", start: 10, end: 5, text: "" }, "RANGE_OUT_OF_BOUNDS");
  });

  test("RANGE_OUT_OF_BOUNDS si start dépasse la fin du texte", () => {
    expectUnchanged(
      BASE,
      { kind: "splice", start: BASE.length + 5, end: BASE.length + 5, text: "x" },
      "RANGE_OUT_OF_BOUNDS",
    );
  });

  test("un splice en toute fin de texte est accepté", () => {
    const applied = expectOk(BASE, {
      kind: "splice",
      start: BASE.length,
      end: BASE.length,
      text: "# fin\n",
    });
    expect(applied.text).toBe(`${BASE}# fin\n`);
  });

  test("STALE_DOCUMENT si le baseHash ne correspond pas", () => {
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
