import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGNOSTIC_CODES } from "../src/diagnostics.ts";
import { OPERATION_ERROR_CODES } from "../src/operations.ts";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const documentation = readFileSync(join(repoRoot, "specs", "diagnostics.md"), "utf8");

describe("contrat public des codes", () => {
  for (const code of DIAGNOSTIC_CODES) {
    test(`le diagnostic ${code} est documenté dans specs/diagnostics.md`, () => {
      expect(documentation).toContain(`\`${code}\``);
    });
  }

  for (const code of OPERATION_ERROR_CODES) {
    test(`l'erreur d'opération ${code} est documentée dans specs/diagnostics.md`, () => {
      expect(documentation).toContain(`\`${code}\``);
    });
  }

  test("aucun code n'est déclaré deux fois", () => {
    const all = [...DIAGNOSTIC_CODES, ...OPERATION_ERROR_CODES];
    expect(new Set(all).size).toBe(all.length);
  });

  test("les constantes valent leur propre nom", () => {
    for (const code of [...DIAGNOSTIC_CODES, ...OPERATION_ERROR_CODES]) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
    }
  });
});
