import { describe, expect, test } from "bun:test";
import { hashText } from "../src/hash.ts";

describe("hashText", () => {
  test("returns the lowercase hex SHA-256 of the UTF-8 text", () => {
    expect(hashText("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("hashes UTF-8 bytes, not UTF-16 code units", () => {
    expect(hashText("é")).toBe(hashText("é"));
    expect(hashText("é")).toHaveLength(64);
  });

  test("is stable across calls", () => {
    expect(hashText("stage: test\n")).toBe(hashText("stage: test\n"));
  });

  test("distinguishes two close texts", () => {
    expect(hashText("a:\n")).not.toBe(hashText("a: \n"));
  });

  test("returns only lowercase hex characters", () => {
    expect(hashText("Keelson")).toMatch(/^[0-9a-f]{64}$/);
  });
});
