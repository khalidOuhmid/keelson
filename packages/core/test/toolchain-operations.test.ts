import { describe, expect, test } from "bun:test";
import { parseToolchainOperation } from "../src/index.ts";

const BASE = { v: 1, baseHash: "a".repeat(64) };

describe("opérations de toolchain", () => {
  test("une opération valide passe", () => {
    const parsed = parseToolchainOperation({
      ...BASE,
      kind: "addIntegration",
      job: "build",
      service: "nexus",
      integration: "push",
    });
    expect(parsed.ok).toBe(true);
  });

  test("un type d'intégration inconnu est refusé par le schéma", () => {
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

  test("une version inconnue est refusée", () => {
    const parsed = parseToolchainOperation({ ...BASE, v: 2, kind: "removeService", id: "x" });
    expect(parsed.ok ? null : parsed.error.code).toBe("UNSUPPORTED_VERSION");
  });

  test("ce qui n'est pas un objet est refusé", () => {
    expect(parseToolchainOperation(null).ok).toBe(false);
  });
});
