import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGNOSTIC_CODES } from "../src/diagnostics.ts";
import { OPERATION_ERROR_CODES } from "../src/operations.ts";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const documentation = readFileSync(join(repoRoot, "specs", "diagnostics.md"), "utf8");

describe("public contract of the codes", () => {
  for (const code of DIAGNOSTIC_CODES) {
    test(`diagnostic ${code} is documented in specs/diagnostics.md`, () => {
      expect(documentation).toContain(`\`${code}\``);
    });
  }

  for (const code of OPERATION_ERROR_CODES) {
    test(`operation error ${code} is documented in specs/diagnostics.md`, () => {
      expect(documentation).toContain(`\`${code}\``);
    });
  }

  test("no code is declared twice", () => {
    const all = [...DIAGNOSTIC_CODES, ...OPERATION_ERROR_CODES];
    expect(new Set(all).size).toBe(all.length);
  });

  test("constants equal their own name", () => {
    for (const code of [...DIAGNOSTIC_CODES, ...OPERATION_ERROR_CODES]) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
    }
  });
});
