import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createFileReader, parse } from "@keelson/adapter-gitlab";
import type { Diagnostic } from "@keelson/core";
import { hasErrors, validate as validatePipeline } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";

export const DEFAULT_FILE = ".gitlab-ci.yml";

const FORMATS = ["text", "json"] as const;

type Format = (typeof FORMATS)[number];

type Options = {
  file: string;
  format: Format;
};

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson validate: ${message}\n`, exitCode: 2 };
}

function parseArguments(argv: readonly string[], cwd: string): Options | CliResult {
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

  const target = parsed.positionals[0] ?? DEFAULT_FILE;
  return {
    file: isAbsolute(target) ? target : resolve(cwd, target),
    format: (requested ?? "text") as Format,
  };
}

/** La racine depuis laquelle GitLab résout les `include: local`. On remonte jusqu'au premier
 *  dossier qui contient un `.git`, parce que c'est la racine du dépôt que GitLab utilise. Sans
 *  dépôt — un fichier isolé, un test — c'est le dossier du fichier, ce qui revient au cas normal
 *  où `.gitlab-ci.yml` est à la racine. */
function repositoryRoot(file: string): string {
  let current = dirname(file);
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return dirname(file);
    }
    current = parent;
  }
}

/** Le chemin du fichier relatif à la racine, en séparateurs `/` : c'est la forme qu'attendent les
 *  `include` et celle que portent les diagnostics. */
function relativeTo(root: string, file: string): string {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return file.startsWith(prefix) ? file.slice(prefix.length).split(sep).join("/") : basename(file);
}

function positionOf(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

/** `--format json` expose **et** les `params` **et** le `message` rendu : les `params` sont le
 *  contrat, que des scripts lisent ; le message est ce qu'un humain lit dans la sortie d'une CI. */
type Reported = {
  file: string;
  code: string;
  severity: Diagnostic["severity"];
  params: Record<string, unknown>;
  message: string;
  line: number;
  column: number;
};

/** Chaque diagnostic est situé dans le texte de **son** fichier. Convertir un offset d'un fichier
 *  inclus avec le texte du fichier principal donnerait une ligne et une colonne qui existent, mais
 *  qui ne désignent rien. */
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
      // Chemin absolu, comme avant ce lot : c'est ce qu'un terminal rend cliquable et ce qu'un
      // script de CI attendait déjà. Le diagnostic, lui, porte le chemin relatif à la racine,
      // qui est la forme du contrat.
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
  const parsed = parseArguments(argv, cwd);
  if ("exitCode" in parsed) {
    return parsed;
  }

  let text: string;
  try {
    if (!statSync(parsed.file).isFile()) {
      return usage(`"${parsed.file}" is not a file`);
    }
    text = readFileSync(parsed.file, "utf8");
  } catch {
    return usage(`file not found: ${parsed.file}`);
  }

  const root = repositoryRoot(parsed.file);
  const main = relativeTo(root, parsed.file);
  const result = parse(text, { file: main, read: createFileReader(root) });
  const diagnostics = [...result.diagnostics, ...validatePipeline(result.pipeline)];
  const texts = new Map<string, string>([[main, text], ...Object.entries(result.included)]);
  const reported = report(root, texts, diagnostics);

  return {
    stdout:
      parsed.format === "json" ? `${JSON.stringify(reported, null, 2)}\n` : renderText(reported),
    stderr: "",
    exitCode: hasErrors(diagnostics) ? 1 : 0,
  };
}
