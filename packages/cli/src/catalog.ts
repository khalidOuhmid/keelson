import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { lintCatalog, loadCatalog, type ToolFile } from "@keelson/catalog";
import { hasErrors } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson catalog: ${message}\n`, exitCode: 2 };
}

function readDirectory(directory: string): ToolFile[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => ({ file: name, text: readFileSync(join(directory, name), "utf8") }));
}

/** Sans dossier, c'est le catalogue embarqué qui est relu : du JSON est du YAML valide. */
function embedded(): ToolFile[] {
  return loadCatalog().tools.map((tool) => ({
    file: `${tool.id}.yaml`,
    text: JSON.stringify(tool),
  }));
}

export function catalogCommand(argv: readonly string[], cwd: string, now: Date): CliResult {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "lint") {
    return usage(`unknown subcommand "${subcommand ?? ""}", expected lint`);
  }

  const parsed = parseCommandArgs(rest, { options: {}, allowPositionals: true });
  if (!parsed.ok) {
    return usage(parsed.message);
  }
  if (parsed.positionals.length > 1) {
    return usage(`expected a single directory, "${parsed.positionals[1]}" is one too many`);
  }

  const directory = parsed.positionals[0];
  let files: ToolFile[];
  try {
    files =
      directory === undefined
        ? embedded()
        : readDirectory(isAbsolute(directory) ? directory : resolve(cwd, directory));
  } catch {
    return usage(`directory not found: ${directory}`);
  }

  if (files.length === 0) {
    return usage(`no .yaml tool file in ${directory}`);
  }

  const diagnostics = lintCatalog(files, loadCatalog().logos, now);
  const lines = diagnostics.map(
    (entry) => `${entry.file} ${entry.severity} ${entry.code} ${renderMessage(entry)}\n`,
  );
  return {
    stdout: lines.length === 0 ? `${files.length} tools, no findings\n` : lines.join(""),
    stderr: "",
    exitCode: hasErrors(diagnostics) ? 1 : 0,
  };
}
