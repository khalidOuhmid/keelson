import { type Coverage, coverage, loadCatalog } from "@keelson/catalog";
import type { Diagnostic } from "@keelson/core";
import { COVERAGE_LAYER_MISSING, hasErrors, INVALID_YAML } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { findLayer, isLayerId, type LayerId } from "@keelson/taxonomy";
import { analyse, readTargets } from "./analysis.ts";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson coverage: ${message}\n`, exitCode: 2 };
}

function missingRequired(
  required: readonly LayerId[],
  result: Coverage,
  file: string,
): Diagnostic[] {
  return required.flatMap((layer): Diagnostic[] =>
    result.layers.some((entry) => entry.layer === layer && entry.covered)
      ? []
      : [
          {
            code: COVERAGE_LAYER_MISSING,
            severity: "error",
            params: { layer, name: findLayer(layer).name },
            range: null,
            file,
          },
        ],
  );
}

function renderText(result: Coverage, messages: readonly string[]): string {
  const lines = result.layers.map((entry) => {
    const state = entry.covered ? "covered" : "missing";
    const jobs = entry.jobs.length === 0 ? "" : `  ${entry.jobs.join(", ")}`;
    const services = entry.services.map((service) => `  service ${service}`).join("");
    const ci = entry.ci.map((system) => `  ci ${system}`).join("");
    return `${state}  ${entry.layer.padEnd(26)}${findLayer(entry.layer).name}${jobs}${services}${ci}`;
  });
  if (result.partial) {
    lines.push("", "partial: part of the pipeline could not be read, so coverage is a lower bound");
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

  const read = readTargets(parsed.positionals[0], cwd);
  if (!read.ok) {
    return usage(read.message);
  }

  const file = read.targets[0]?.file ?? cwd;
  const analysis = analyse(read.targets);
  const result = coverage(
    analysis.pipeline,
    loadCatalog().tools,
    analysis.layout.overrides,
    analysis.parsing,
    analysis.toolchain.toolchain.services,
  );
  const missing = missingRequired(requested.filter(isLayerId), result, file);
  const unreadable = analysis.parsing.filter((entry) => entry.code === INVALID_YAML);
  const notes = [
    ...unreadable,
    ...analysis.layout.diagnostics,
    ...analysis.toolchain.diagnostics,
    ...missing,
  ];

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
