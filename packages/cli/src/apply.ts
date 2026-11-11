import { existsSync, lstatSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { apply, createFileReader, parse, readInsideRoot } from "@keelson/adapter-gitlab";
import type { Operation, OperationError } from "@keelson/core";
import { parseOperation } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { writeInsideRoot } from "@keelson/server";
import { DEFAULT_FILE } from "./analysis.ts";
import { parseCommandArgs } from "./args.ts";
import { hunks, renderUnified } from "./diff.ts";
import { readRegularFile } from "./files.ts";
import type { CliResult } from "./result.ts";

type Options = {
  operations: string;
  repositories: string[];
  file: string;
  rebase: boolean;
  dryRun: boolean;
  json: boolean;
};

type Failure = {
  message: string;
  operation?: number;
  kind?: Operation["kind"];
  code?: OperationError["code"];
  params?: OperationError["params"];
};

type Outcome =
  | { repo: string; ok: true; applied: number; written: boolean; hash: string; diff: string }
  | { repo: string; ok: false; error: Failure };

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson apply: ${message}\n`, exitCode: 2 };
}

function parseArguments(argv: readonly string[]): Options | CliResult {
  const parsed = parseCommandArgs<{
    file?: string;
    rebase?: boolean;
    "dry-run"?: boolean;
    json?: boolean;
  }>(argv, {
    options: {
      file: { type: "string" },
      rebase: { type: "boolean" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (!parsed.ok) {
    return usage(parsed.message);
  }

  const [operations, ...repositories] = parsed.positionals;
  if (operations === undefined) {
    return usage("expected an operations file: keelson apply <ops.json> [<repo-dir>...]");
  }

  return {
    operations,
    repositories,
    file: parsed.values.file ?? DEFAULT_FILE,
    rebase: parsed.values.rebase ?? false,
    dryRun: parsed.values["dry-run"] ?? false,
    json: parsed.values.json ?? false,
  };
}

/** Every operation is validated before the first repository is touched: a half-valid file is
 *  applied nowhere. */
function loadOperations(path: string): Operation[] | CliResult {
  const read = readRegularFile(path);
  if (!read.ok) {
    return usage(read.reason === "notFile" ? `"${path}" is not a file` : `file not found: ${path}`);
  }
  const text = read.text;

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return usage(`${path} is not valid JSON`);
  }

  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) {
    return usage("the operations file contains no operation");
  }

  const operations: Operation[] = [];
  for (const [index, candidate] of list.entries()) {
    const validated = parseOperation(candidate);
    if (!validated.ok) {
      const where = Array.isArray(input) ? `operations[${index}]` : "operation";
      return usage(`${where}: ${renderMessage(validated.error)}`);
    }
    operations.push(validated.value);
  }
  return operations;
}

function insideRoot(root: string, path: string): boolean {
  const rel = relative(root, resolve(root, path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

async function applyTo(
  label: string,
  root: string,
  operations: readonly Operation[],
  options: Options,
): Promise<Outcome> {
  const fail = (error: Failure): Outcome => ({ repo: label, ok: false, error });

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return fail({ message: "not a directory" });
  }
  if (!insideRoot(root, options.file)) {
    return fail({ message: `${options.file} is outside the repository` });
  }

  const original = readInsideRoot(root, options.file);
  if (original === null) {
    return fail({
      message: exists(resolve(root, options.file))
        ? `${options.file} is outside the repository`
        : `file not found: ${options.file}`,
    });
  }

  const main = relative(root, resolve(root, options.file)).split("\\").join("/");
  let document = parse(original, { file: main, read: createFileReader(root) }).document;

  for (const [index, operation] of operations.entries()) {
    const anchored = options.rebase ? { ...operation, baseHash: document.hash } : operation;
    const result = apply(document, anchored);
    if (!result.ok) {
      return fail({
        operation: index,
        kind: operation.kind,
        code: result.error.code,
        params: result.error.params,
        message: renderMessage(result.error),
      });
    }
    document = result.value.document;
  }

  if (!options.dryRun && document.text !== original) {
    const written = await writeInsideRoot(root, options.file, document.text).catch(() => false);
    if (!written) {
      return fail({ message: `could not write ${options.file}` });
    }
  }

  return {
    repo: label,
    ok: true,
    applied: operations.length,
    written: !options.dryRun,
    hash: document.hash,
    diff: options.dryRun ? dryRunReport(`${label}/${main}`, original, document) : "",
  };
}

function dryRunReport(label: string, before: string, after: { text: string; hash: string }) {
  const found = hunks(before, after.text);
  const added = found.reduce((total, hunk) => total + hunk.after.count, 0);
  const removed = found.reduce((total, hunk) => total + hunk.before.count, 0);
  return `  +${added} -${removed} line(s), new hash ${after.hash}\n${renderUnified(label, before, after.text)}`;
}

function describe(error: Failure): string {
  return error.operation === undefined
    ? error.message
    : `operations[${error.operation}] (${error.kind}): ${error.message}`;
}

function renderText(outcomes: readonly Outcome[], dryRun: boolean): string {
  return outcomes
    .map((outcome) =>
      outcome.ok
        ? `✓ ${outcome.repo}  ${outcome.applied} operation(s) applied${
            dryRun ? " (dry run, nothing written)" : ""
          }\n${outcome.diff}`
        : `✗ ${outcome.repo}  ${describe(outcome.error)}\n`,
    )
    .join("");
}

function renderJson(outcomes: readonly Outcome[]): string {
  const results = outcomes.map((outcome) =>
    outcome.ok
      ? {
          repo: outcome.repo,
          ok: true,
          applied: outcome.applied,
          written: outcome.written,
          hash: outcome.hash,
        }
      : {
          repo: outcome.repo,
          ok: false,
          applied: 0,
          written: false,
          error: outcome.error,
        },
  );
  return `${JSON.stringify({ results }, null, 2)}\n`;
}

/** Each repository is independent: one failing does not stop the others from being written, and
 *  the exit code only says whether at least one failed. */
export async function applyCommand(argv: readonly string[], cwd: string): Promise<CliResult> {
  const options = parseArguments(argv);
  if ("exitCode" in options) {
    return options;
  }

  const operations = loadOperations(resolve(cwd, options.operations));
  if ("exitCode" in operations) {
    return operations;
  }

  const targets = options.repositories.length === 0 ? ["."] : options.repositories;
  const outcomes: Outcome[] = [];
  for (const target of targets) {
    outcomes.push(await applyTo(target, resolve(cwd, target), operations, options));
  }

  return {
    stdout: options.json ? renderJson(outcomes) : renderText(outcomes, options.dryRun),
    stderr: "",
    exitCode: outcomes.every((outcome) => outcome.ok) ? 0 : 1,
  };
}
