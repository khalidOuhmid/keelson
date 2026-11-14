import { describe, expect, test } from "bun:test";
import { addressFor, fileInAddress } from "../src/api/address.ts";

describe("the open file in the address", () => {
  test("is read back from the hash it was written to", () => {
    const hash = addressFor(".github/workflows/release.yml");
    expect(fileInAddress(hash)).toBe(".github/workflows/release.yml");
  });

  test("survives characters that mean something in a URL", () => {
    expect(fileInAddress(addressFor("ci/a b#c&d=e.yml"))).toBe("ci/a b#c&d=e.yml");
  });

  test("an empty or foreign hash names no file", () => {
    expect(fileInAddress("")).toBeNull();
    expect(fileInAddress("#")).toBeNull();
    expect(fileInAddress("#section")).toBeNull();
    expect(fileInAddress("#file=")).toBeNull();
  });

  test("never carries a token", () => {
    expect(addressFor("ci.yml")).not.toContain("token");
    expect(fileInAddress("#token=abc")).toBeNull();
  });
});
