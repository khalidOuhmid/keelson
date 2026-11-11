import { describe, expect, test } from "bun:test";
import { parseToolchainOperation } from "../src/index.ts";

const BASE = { v: 1, baseHash: "a".repeat(64) };

describe("toolchain operations", () => {
  test("a valid operation passes", () => {
    const parsed = parseToolchainOperation({
      ...BASE,
      kind: "addIntegration",
      job: "build",
      service: "nexus",
      integration: "push",
    });
    expect(parsed.ok).toBe(true);
  });

  test("an unknown integration kind is rejected by the schema", () => {
    const parsed = parseToolchainOperation({
      ...BASE,
      kind: "addIntegration",
      job: "build",
      service: "nexus",
      integration: "deploy",
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? null : parsed.error.code).toBe("INVALID_OPERATION");
  });

  test("an unknown version is rejected", () => {
    const parsed = parseToolchainOperation({ ...BASE, v: 2, kind: "removeService", id: "x" });
    expect(parsed.ok ? null : parsed.error.code).toBe("UNSUPPORTED_VERSION");
  });

  test("anything that is not an object is rejected", () => {
    expect(parseToolchainOperation(null).ok).toBe(false);
  });
});
