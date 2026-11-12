import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createFileReader, readRegularFile } from "@keelson/adapter-gitlab";
import type { Operation, OperationError, Result, ToolchainOperation } from "@keelson/core";
import {
  hashText,
  ok,
  parseOperation,
  parseRebasableOperation,
  parseRebasableToolchainOperation,
  parseToolchainOperation,
  STALE_DOCUMENT,
  TOOLCHAIN_FILE,
} from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { adapterFor, blockedParent, withFileLock, writeInsideRoot } from "@keelson/server";
import { applyToolchain } from "@keelson/toolchain";
import { DEFAULT_FILE } from "./analysis.ts";
import { parseCommandArgs } from "./args.ts";
import { hunks, renderUnified } from "./diff.ts";
import { readInside, refusalMessage } from "./files.ts";
import type { CliResult } from "./result.ts";

type Options = {
  operations: string;
  repositories: string[];
  file: string;
  rebase: boolean;
  dryRun: boolean;
  json: boolean;
};

/** Called between the computation and the write: the window a concurrent write falls into. */
export type ApplyHooks = {
  beforeWrite?: (root: string, file: string) => void;
  lockTimeoutMs?: number;
};

type Step = { kind: string; baseHash?: string };

type Failure = {
  message: string;
  operation?: number;
  kind?: string;
  code?: OperationError["code"];
  params?: OperationError["params"];
};

type Outcome =
  | { repo: string; ok: true; applied: number; written: boolean; hash: string; diff: string }
  | { repo: string; ok: false; error: Failure };

/** A text and what applying one more operation to it gives. */
type Session = {
  text: string;
  hash: string;
  apply(operation: Step): Result<Session, OperationError>;
};

/** What `--file` designates: a CI file, read by the adapter of its provider, or the toolchain,
 *  which `keelson start` creates when it is missing and so does `apply`. */
type Target = {
  validate(candidate: unknown, rebase: boolean): Result<Step, OperationError>;
  whenAbsent: string | null;
  open(root: string, file: string, text: string): Session;
};

function ciSession(file: string, root: string, text: string): Session {
  const adapter = adapterFor(file);
  const read = createFileReader(root);
  const parsed = adapter.parse(text, { file, read });
  return {
    text,
    hash: parsed.hash,
    apply: (operation) => {
      const result = adapter.apply(parsed, operation as Operation);
      return result.ok ? ok(ciSession(file, root, result.value.text)) : result;
    },
  };
}

function toolchainSession(text: string): Session {
  return {
    text,
    hash: hashText(text),
    apply: (operation) => {
      const result = applyToolchain(text, operation as ToolchainOperation);
      return result.ok ? ok(toolchainSession(result.value.text)) : result;
    },
  };
}

const CI_TARGET: Target = {
  validate: (candidate, rebase) =>
    rebase ? parseRebasableOperation(candidate) : parseOperation(candidate),
  whenAbsent: null,
  open: (root, file, text) => ciSession(file, root, text),
};

const TOOLCHAIN_TARGET: Target = {
  validate: (candidate, rebase) =>
    rebase ? parseRebasableToolchainOperation(candidate) : parseToolchainOperation(candidate),
  whenAbsent: "",
  open: (_root, _file, text) => toolchainSession(text),
};

function normalised(file: string): string {
  return file.split("\\").join("/").replace(/^\.\//, "");
}

function targetFor(file: string): Target {
  return normalised(file) === TOOLCHAIN_FILE ? TOOLCHAIN_TARGET : CI_TARGET;
}

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
 *  applied nowhere. Under `--rebase` the anchor is each repository's text, so it may be left out. */
function loadOperations(path: string, target: Target, rebase: boolean): Step[] | CliResult {
  const read = readRegularFile(path);
  if (!read.ok) {
    return usage(read.reason === "notFile" ? `"${path}" is not a file` : `file not found: ${path}`);
  }

  let input: unknown;
  try {
    input = JSON.parse(read.text);
  } catch {
    return usage(`${path} is not valid JSON`);
  }

  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) {
    return usage("the operations file contains no operation");
  }

  const operations: Step[] = [];
  for (const [index, candidate] of list.entries()) {
    const validated = target.validate(candidate, rebase);
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

type Read = { ok: true; text: string } | { ok: false; message: string };

function readTarget(root: string, file: string, target: Target): Read {
  const read = readInside(root, file);
  if (read.ok) {
    return read;
  }
  if (read.reason !== "absent") {
    return { ok: false, message: refusalMessage(read.reason, file) };
  }
  const blocked = blockedParent(root, file);
  if (blocked !== null) {
    return { ok: false, message: `${blocked} is not a directory` };
  }
  return target.whenAbsent === null
    ? { ok: false, message: `file not found: ${file}` }
    : { ok: true, text: target.whenAbsent };
}

async function applyTo(
  label: string,
  root: string,
  operations: readonly Step[],
  options: Options,
  hooks: ApplyHooks,
): Promise<Outcome> {
  const fail = (error: Failure): Outcome => ({ repo: label, ok: false, error });

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return fail({ message: "not a directory" });
  }
  if (!insideRoot(root, options.file)) {
    return fail({ message: `${options.file} is outside the repository` });
  }

  const main = relative(root, resolve(root, options.file)).split("\\").join("/");
  const target = targetFor(main);
  const original = readTarget(root, main, target);
  if (!original.ok) {
    return fail({ message: original.message });
  }

  let session = target.open(root, main, original.text);
  for (const [index, operation] of operations.entries()) {
    const anchored = options.rebase ? { ...operation, baseHash: session.hash } : operation;
    const result = session.apply(anchored);
    if (!result.ok) {
      return fail({
        operation: index,
        kind: operation.kind,
        code: result.error.code,
        params: result.error.params,
        message: renderMessage(result.error),
      });
    }
    session = result.value;
  }

  if (!options.dryRun && session.text !== original.text) {
    hooks.beforeWrite?.(root, main);
    const lockOptions = hooks.lockTimeoutMs === undefined ? {} : { timeoutMs: hooks.lockTimeoutMs };
    const refused = await withFileLock(
      root,
      resolve(root, main),
      async () => {
        const now = readTarget(root, main, target);
        if (!now.ok || now.text !== original.text) {
          const error = {
            code: STALE_DOCUMENT,
            params: {
              expected: hashText(now.ok ? now.text : ""),
              received: hashText(original.text),
            },
          } as const;
          return { ...error, message: renderMessage(error) };
        }
        const written = await writeInsideRoot(root, main, session.text).catch(() => false);
        return written ? null : { message: `could not write ${main}` };
      },
      lockOptions,
    ).catch((error: Error) => ({ message: error.message }));
    if (refused !== null) {
      return fail(refused);
    }
  }

  return {
    repo: label,
    ok: true,
    applied: operations.length,
    written: !options.dryRun,
    hash: session.hash,
    diff: options.dryRun ? dryRunReport(`${label}/${main}`, original.text, session) : "",
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
export async function applyCommand(
  argv: readonly string[],
  cwd: string,
  hooks: ApplyHooks = {},
): Promise<CliResult> {
  const options = parseArguments(argv);
  if ("exitCode" in options) {
    return options;
  }

  const operations = loadOperations(
    resolve(cwd, options.operations),
    targetFor(options.file),
    options.rebase,
  );
  if ("exitCode" in operations) {
    return operations;
  }

  const targets = options.repositories.length === 0 ? ["."] : options.repositories;
  const outcomes: Outcome[] = [];
  for (const target of targets) {
    outcomes.push(await applyTo(target, resolve(cwd, target), operations, options, hooks));
  }

  return {
    stdout: options.json ? renderJson(outcomes) : renderText(outcomes, options.dryRun),
    stderr: "",
    exitCode: outcomes.every((outcome) => outcome.ok) ? 0 : 1,
  };
}
