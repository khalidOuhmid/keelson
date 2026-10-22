import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(packageRoot, "src");
export const TOKENS_FILE = "tokens.css";

type Offence = {
  file: string;
  line: number;
  text: string;
  reason: string;
};

const FORBIDDEN: { reason: string; pattern: RegExp }[] = [
  { reason: "couleur hexadécimale", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { reason: "rgb(", pattern: /\brgba?\s*\(/ },
  { reason: "hsl(", pattern: /\bhsla?\s*\(/ },
  { reason: "valeur en px", pattern: /\b\d+(?:\.\d+)?px\b/ },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

function scan(): Offence[] {
  const offences: Offence[] = [];

  for (const path of sourceFiles(sourceRoot)) {
    const name = relative(sourceRoot, path).split(/[\\/]/).join("/");
    if (name === TOKENS_FILE) {
      continue;
    }

    for (const [index, text] of readFileSync(path, "utf8").split("\n").entries()) {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(text)) {
          offences.push({ file: name, line: index + 1, text: text.trim(), reason: rule.reason });
        }
      }
    }
  }

  return offences;
}

describe("aucune valeur de design en dur hors du fichier de tokens", () => {
  test("le fichier de tokens existe et porte les tokens", () => {
    const tokens = readFileSync(join(sourceRoot, TOKENS_FILE), "utf8");
    expect(tokens).toContain("@theme");
    expect(tokens).toContain("--color-surface-0");
    expect(tokens).toContain("--keelson-node-width");
  });

  test("aucun fichier de src/ ne contient de valeur de design en dur", () => {
    const offences = scan();
    const report = offences
      .map((offence) => `${offence.file}:${offence.line} ${offence.reason} — ${offence.text}`)
      .join("\n");
    expect(report).toBe("");
  });

  test("le scanner repère bien une couleur hexadécimale", () => {
    const rule = FORBIDDEN[0];
    expect(rule?.pattern.test("color: #1d4ed8;")).toBe(true);
    expect(rule?.pattern.test("const label = 'build';")).toBe(false);
  });

  test("le scanner repère bien rgb, hsl et px", () => {
    expect(FORBIDDEN[1]?.pattern.test("background: rgba(0, 0, 0, 0.4);")).toBe(true);
    expect(FORBIDDEN[2]?.pattern.test("color: hsl(220 10% 50%);")).toBe(true);
    expect(FORBIDDEN[3]?.pattern.test("width: 232px;")).toBe(true);
    expect(FORBIDDEN[3]?.pattern.test("gap: var(--keelson-row-gap);")).toBe(false);
  });

  test("le scanner couvre bien plusieurs fichiers", () => {
    expect(sourceFiles(sourceRoot).length).toBeGreaterThan(3);
  });
});
