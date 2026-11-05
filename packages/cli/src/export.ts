import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { coverage, loadCatalog } from "@keelson/catalog";
import { renderCoverageMarkdown, renderMermaid } from "@keelson/toolchain";
import { analyse } from "./analysis.ts";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";
import { DEFAULT_FILE } from "./validate.ts";

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
  const { pipeline, diagnostics } = analysis.result;
  const { toolchain } = analysis.toolchain;
  const result = coverage(
    pipeline,
    loadCatalog().tools,
    analysis.layout.overrides,
    diagnostics,
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
