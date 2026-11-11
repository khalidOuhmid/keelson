import { describe, expect, test } from "bun:test";
import { hashText } from "@keelson/core";
import { STALE_DOCUMENT } from "@keelson/core/messages";
import { apply } from "../src/apply.ts";
import { parse } from "../src/parse.ts";
import { BASE, expectOk } from "./support/apply.ts";

function withHash(baseHash: string) {
  return { v: 1 as const, baseHash, kind: "removeJob" as const, id: "unit" };
}

describe("baseHash preconditions", () => {
  test("STALE_DOCUMENT when the baseHash does not match", () => {
    const result = apply(parse(BASE).document, withHash("0".repeat(64)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_DOCUMENT");
    }
  });

  test("the text stays intact after a refusal", () => {
    const document = parse(BASE).document;
    apply(document, withHash("0".repeat(64)));
    expect(document.text).toBe(BASE);
  });

  test("the message names both hashes", () => {
    const result = apply(parse(BASE).document, withHash("0".repeat(64)));
    if (!result.ok) {
      const params = result.error.code === STALE_DOCUMENT ? result.error.params : null;
      expect(params?.expected).toBe(hashText(BASE));
      expect(params?.received).toBe("0".repeat(64));
    }
  });

  test("the right baseHash is accepted", () => {
    expect(expectOk(BASE, { kind: "removeJob", id: "unit" }).text).not.toBe(BASE);
  });

  test("applying the same operation twice fails the second time", () => {
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

  test("the next operation must carry the hash returned by the previous one", () => {
    const first = expectOk(BASE, { kind: "removeJob", id: "unit" });
    const second = apply(first.document, {
      v: 1,
      baseHash: first.hash,
      kind: "removeJob",
      id: "compile",
    });
    expect(second.ok).toBe(true);
  });

  test("an unknown version is rejected before any write", () => {
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
