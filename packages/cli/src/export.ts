import { coverage, loadCatalog } from "@keelson/catalog";
import { renderCoverageMarkdown, renderMermaid } from "@keelson/toolchain";
import { analyse, readTargets } from "./analysis.ts";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";

const FORMATS = ["markdown", "mermaid", "json"] as const;

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson export: ${message}\n`, exitCode: 2 };
}

export function exportCommand(argv: readonly string[], cwd: string): CliResult {
  const parsed = parseCommandArgs<{ format?: string }>(argv, {
    options: { format: { type: "string" } },
    allowPositionals: true,
  });
  if (!parsed.ok) {
    return usage(parsed.message);
  }

  const format = parsed.values.format ?? "markdown";
  if (!(FORMATS as readonly string[]).includes(format)) {
    return usage(`unknown format "${format}", expected ${FORMATS.join(", ")}`);
  }
  if (parsed.positionals.length > 1) {
    return usage(`expected a single file, "${parsed.positionals[1]}" is one too many`);
  }

  const read = readTargets(parsed.positionals[0], cwd);
  if (!read.ok) {
    return usage(read.message);
  }

  const analysis = analyse(read.targets);
  const { pipeline, parsing } = analysis;
  const { toolchain } = analysis.toolchain;
  const result = coverage(
    pipeline,
    loadCatalog().tools,
    analysis.layout.overrides,
    parsing,
    toolchain.services,
  );

  const stdout =
    format === "mermaid"
      ? renderMermaid(pipeline, toolchain)
      : format === "markdown"
        ? renderCoverageMarkdown(result)
        : `${JSON.stringify(
            { pipeline, coverage: result, toolchain, diagnostics: analysis.diagnostics },
            null,
            2,
          )}\n`;
  return { stdout, stderr: "", exitCode: 0 };
}
