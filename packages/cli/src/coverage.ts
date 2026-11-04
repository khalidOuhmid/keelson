import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { type Coverage, coverage, loadCatalog } from "@keelson/catalog";
import type { Diagnostic } from "@keelson/core";
import { COVERAGE_LAYER_MISSING, hasErrors, INVALID_YAML } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { findLayer, isLayerId, type LayerId } from "@keelson/taxonomy";
import { analyse } from "./analysis.ts";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";
import { DEFAULT_FILE } from "./validate.ts";

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson coverage: ${message}\n`, exitCode: 2 };
}

function missingRequired(required: readonly LayerId[], result: Coverage): Diagnostic[] {
  return required.flatMap((layer): Diagnostic[] =>
    result.layers.some((entry) => entry.layer === layer && entry.covered)
      ? []
      : [
          {
            code: COVERAGE_LAYER_MISSING,
            severity: "error",
            params: { layer, name: findLayer(layer).name },
            range: null,
            file: "",
          },
        ],
  );
}

function renderText(result: Coverage, messages: readonly string[]): string {
  const lines = result.layers.map((entry) => {
    const state = entry.covered ? "covered" : "missing";
    const jobs = entry.jobs.length === 0 ? "" : `  ${entry.jobs.join(", ")}`;
    return `${state}  ${entry.layer.padEnd(26)}${findLayer(entry.layer).name}${jobs}`;
  });
  if (result.partial) {
    lines.push("", "partial: some includes are not resolved, so coverage is a lower bound");
  }
  return `${[...lines, ...messages].join("\n")}\n`;
}

export function coverageCommand(argv: readonly string[], cwd: string): CliResult {
  const parsed = parseCommandArgs<{ format?: string; require?: string }>(argv, {
    options: { format: { type: "string" }, require: { type: "string" } },
    allowPositionals: true,
  });
  if (!parsed.ok) {
    return usage(parsed.message);
  }

  const format = parsed.values.format ?? "text";
  if (format !== "text" && format !== "json") {
    return usage(`unknown format "${format}", expected text or json`);
  }
  if (parsed.positionals.length > 1) {
    return usage(`expected a single file, "${parsed.positionals[1]}" is one too many`);
  }

  if (parsed.values.require?.trim() === "") {
    return usage("--require names no layer");
  }

  const requested = (parsed.values.require ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const unknown = requested.find((entry) => !isLayerId(entry));
  if (unknown !== undefined) {
    return usage(`unknown layer "${unknown}"`);
  }

  const target = parsed.positionals[0] ?? DEFAULT_FILE;
  const file = isAbsolute(target) ? target : resolve(cwd, target);
  let text: string;
  try {
    if (!statSync(file).isFile()) {
      return usage(`"${file}" is not a file`);
    }
    text = readFileSync(file, "utf8");
  } catch {
    return usage(`file not found: ${file}`);
  }

  const analysis = analyse(file, text);
  const result = coverage(
    analysis.result.pipeline,
    loadCatalog().tools,
    analysis.layout.overrides,
    analysis.result.diagnostics,
  );
  const missing = missingRequired(requested.filter(isLayerId), result);
  const unreadable = analysis.result.diagnostics.filter((entry) => entry.code === INVALID_YAML);
  const notes = [...unreadable, ...analysis.layout.diagnostics, ...missing];

  return {
    stdout:
      format === "json"
        ? `${JSON.stringify(
            {
              ...result,
              missing: missing.map((entry) => entry.params),
              diagnostics: notes.map((entry) => ({ ...entry, message: renderMessage(entry) })),
            },
            null,
            2,
          )}\n`
        : renderText(
            result,
            notes.map((entry) => `${entry.severity} ${entry.code} ${renderMessage(entry)}`),
          ),
    stderr: "",
    exitCode: hasErrors(notes) ? 1 : 0,
  };
}
