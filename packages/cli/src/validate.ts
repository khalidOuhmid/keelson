import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse } from "@keelson/adapter-gitlab";
import type { Diagnostic } from "@keelson/core";
import { hasErrors, validate as validatePipeline } from "@keelson/core";
import type { CliResult } from "./result.ts";

export const DEFAULT_FILE = ".gitlab-ci.yml";

const FORMATS = ["text", "json"] as const;

type Format = (typeof FORMATS)[number];

type Options = {
  file: string;
  format: Format;
};

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson validate : ${message}\n`, exitCode: 2 };
}

function parseArguments(argv: readonly string[], cwd: string): Options | CliResult {
  let file: string | undefined;
  let format: Format = "text";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }

    if (argument === "--format") {
      const value = argv[index + 1];
      if (value === undefined) {
        return usage("l'option --format attend une valeur (text ou json)");
      }
      if (!FORMATS.includes(value as Format)) {
        return usage(`format « ${value} » inconnu, attendu text ou json`);
      }
      format = value as Format;
      index += 1;
      continue;
    }

    if (argument.startsWith("-")) {
      return usage(`option « ${argument} » inconnue`);
    }

    if (file !== undefined) {
      return usage(`un seul fichier attendu, « ${argument} » est en trop`);
    }
    file = argument;
  }

  const target = file ?? DEFAULT_FILE;
  return { file: isAbsolute(target) ? target : resolve(cwd, target), format };
}

function positionOf(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

type Reported = {
  file: string;
  code: string;
  severity: Diagnostic["severity"];
  message: string;
  line: number;
  column: number;
};

function report(file: string, text: string, diagnostics: readonly Diagnostic[]): Reported[] {
  return diagnostics.map((diagnostic) => {
    const { line, column } = positionOf(text, diagnostic.range?.start ?? 0);
    return {
      file,
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message.replace(/\s+/g, " ").trim(),
      line,
      column,
    };
  });
}

function renderText(reported: readonly Reported[]): string {
  if (reported.length === 0) {
    return "aucun diagnostic\n";
  }
  return reported
    .map(
      (entry) =>
        `${entry.file}:${entry.line}:${entry.column} ${entry.severity} ${entry.code} ${entry.message}\n`,
    )
    .join("");
}

export function validateCommand(argv: readonly string[], cwd: string): CliResult {
  const parsed = parseArguments(argv, cwd);
  if ("exitCode" in parsed) {
    return parsed;
  }

  let text: string;
  try {
    if (!statSync(parsed.file).isFile()) {
      return usage(`« ${parsed.file} » n'est pas un fichier`);
    }
    text = readFileSync(parsed.file, "utf8");
  } catch {
    return usage(`fichier introuvable : ${parsed.file}`);
  }

  const result = parse(text);
  const diagnostics = [...result.diagnostics, ...validatePipeline(result.pipeline)];
  const reported = report(parsed.file, text, diagnostics);

  return {
    stdout:
      parsed.format === "json" ? `${JSON.stringify(reported, null, 2)}\n` : renderText(reported),
    stderr: "",
    exitCode: hasErrors(diagnostics) ? 1 : 0,
  };
}
