import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_PACKAGES = [
  "adapter-github",
  "adapter-gitlab",
  "catalog",
  "cli",
  "core",
  "taxonomy",
  "toolchain",
] as const;

export type Violation = {
  file: string;
  line: number;
  reason: "bun:" | "Bun.";
  text: string;
};

const BUN_MODULE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']bun:/;
const BUN_GLOBAL = /(?<![\w$.])Bun\s*\./;

export function scanSource(file: string, content: string): Violation[] {
  const violations: Violation[] = [];

  for (const [index, text] of content.split("\n").entries()) {
    const reason = BUN_MODULE.test(text) ? "bun:" : BUN_GLOBAL.test(text) ? "Bun." : undefined;
    if (reason !== undefined) {
      violations.push({ file, line: index + 1, reason, text: text.trim() });
    }
  }

  return violations;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

export function repoRootFrom(moduleUrl: string): string {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

export function checkRuntime(repoRoot: string): Violation[] {
  const violations: Violation[] = [];

  for (const name of RUNTIME_PACKAGES) {
    const source = join(repoRoot, "packages", name, "src");
    for (const file of sourceFiles(source)) {
      violations.push(
        ...scanSource(relative(repoRoot, file).split(sep).join("/"), readFileSync(file, "utf8")),
      );
    }
  }

  return violations;
}
