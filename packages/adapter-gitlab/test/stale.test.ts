import { describe, expect, test } from "bun:test";
import { hashText } from "@keelson/core";
import { apply } from "../src/apply.ts";
import { parse } from "../src/parse.ts";
import { BASE, expectOk } from "./support/apply.ts";

function withHash(baseHash: string) {
  return { v: 1 as const, baseHash, kind: "removeJob" as const, id: "unit" };
}

describe("préconditions de baseHash", () => {
  test("STALE_DOCUMENT quand le baseHash ne correspond pas", () => {
    const result = apply(parse(BASE).document, withHash("0".repeat(64)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_DOCUMENT");
    }
  });

  test("le texte reste intact après un refus", () => {
    const document = parse(BASE).document;
    apply(document, withHash("0".repeat(64)));
    expect(document.text).toBe(BASE);
  });

  test("le message nomme les deux hash", () => {
    const result = apply(parse(BASE).document, withHash("0".repeat(64)));
    if (!result.ok) {
      expect(result.error.details?.expected).toBe(hashText(BASE));
      expect(result.error.details?.received).toBe("0".repeat(64));
    }
  });

  test("le bon baseHash est accepté", () => {
    expect(expectOk(BASE, { kind: "removeJob", id: "unit" }).text).not.toBe(BASE);
  });

  test("appliquer deux fois la même opération échoue la seconde fois", () => {
    const first = expectOk(BASE, { kind: "removeJob", id: "unit" });
    const replay = apply(first.document, {
      v: 1,
      baseHash: hashText(BASE),
      kind: "removeJob",
      id: "unit",
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error.code).toBe("STALE_DOCUMENT");
    }
  });

  test("l'opération suivante doit porter le hash rendu par la précédente", () => {
    const first = expectOk(BASE, { kind: "removeJob", id: "unit" });
    const second = apply(first.document, {
      v: 1,
      baseHash: first.hash,
      kind: "removeJob",
      id: "compile",
    });
    expect(second.ok).toBe(true);
  });

  test("une version inconnue est rejetée avant toute écriture", () => {
    const document = parse(BASE).document;
    const result = apply(document, {
      v: 2,
      baseHash: hashText(BASE),
      kind: "removeJob",
      id: "unit",
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_VERSION");
    }
    expect(document.text).toBe(BASE);
  });
});
