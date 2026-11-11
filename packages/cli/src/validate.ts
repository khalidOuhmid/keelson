import { resolve } from "node:path";
import type { Diagnostic } from "@keelson/core";
import { hasErrors } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { analyse, readTargets } from "./analysis.ts";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";

const FORMATS = ["text", "json"] as const;

type Format = (typeof FORMATS)[number];

type Options = {
  file: string | undefined;
  format: Format;
};

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson validate: ${message}\n`, exitCode: 2 };
}

function parseArguments(argv: readonly string[]): Options | CliResult {
  const parsed = parseCommandArgs<{ format?: string }>(argv, {
    options: { format: { type: "string" } },
    allowPositionals: true,
  });

  if (!parsed.ok) {
    return usage(parsed.message);
  }

  if (parsed.positionals.length > 1) {
    return usage(`expected a single file, "${parsed.positionals[1]}" is one too many`);
  }

  const requested = parsed.values.format;
  if (requested !== undefined && !FORMATS.includes(requested as Format)) {
    return usage(`unknown format "${requested}", expected text or json`);
  }

  return { file: parsed.positionals[0], format: (requested ?? "text") as Format };
}

function positionOf(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

/** `--format json` exposes **both** the `params` **and** the rendered `message`: the `params` are
 *  the contract, which scripts read; the message is what a human reads in CI output. */
type Reported = {
  file: string;
  code: string;
  severity: Diagnostic["severity"];
  params: Record<string, unknown>;
  message: string;
  line: number;
  column: number;
};

/** Each diagnostic is located in the text of **its own** file. Converting an included file's offset
 *  with the main file's text would give a line and column that exist but point at nothing. */
function report(
  root: string,
  texts: ReadonlyMap<string, string>,
  diagnostics: readonly Diagnostic[],
): Reported[] {
  return diagnostics.map((diagnostic) => {
    const { line, column } = positionOf(
      texts.get(diagnostic.file) ?? "",
      diagnostic.range?.start ?? 0,
    );
    return {
      // Absolute path, as before this milestone: it is what a terminal makes clickable and what a
      // CI script already expected. The diagnostic itself carries the root-relative path, which
      // is the contract's form.
      file: resolve(root, diagnostic.file),
      code: diagnostic.code,
      severity: diagnostic.severity,
      params: diagnostic.params as Record<string, unknown>,
      message: renderMessage(diagnostic).replace(/\s+/g, " ").trim(),
      line,
      column,
    };
  });
}

function renderText(reported: readonly Reported[]): string {
  if (reported.length === 0) {
    return "no diagnostics\n";
  }
  return reported
    .map(
      (entry) =>
        `${entry.file}:${entry.line}:${entry.column} ${entry.severity} ${entry.code} ${entry.message}\n`,
    )
    .join("");
}

export function validateCommand(argv: readonly string[], cwd: string): CliResult {
  const parsed = parseArguments(argv);
  if ("exitCode" in parsed) {
    return parsed;
  }

  const read = readTargets(parsed.file, cwd);
  if (!read.ok) {
    return usage(read.message);
  }

  const { root, texts, diagnostics } = analyse(read.targets);
  const reported = report(root, texts, diagnostics);

  return {
    stdout:
      parsed.format === "json" ? `${JSON.stringify(reported, null, 2)}\n` : renderText(reported),
    stderr: "",
    exitCode: hasErrors(diagnostics) ? 1 : 0,
  };
}
