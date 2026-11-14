import { apply as applyGithub, parse as parseGithub, WORKFLOWS_DIR } from "@keelson/adapter-github";
import {
  apply as applyGitlab,
  type IncludeReader,
  parse as parseGitlab,
} from "@keelson/adapter-gitlab";
import type {
  Diagnostic,
  Operation,
  OperationError,
  Pipeline,
  Result,
  SourceRange,
  SpliceOperation,
} from "@keelson/core";

/** A document, seen without knowing which provider it comes from. */
type Parsed<D> = {
  document: D;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  included: Record<string, string>;
};

type Applied = {
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  inverse: SpliceOperation;
  touched: SourceRange[];
  included: Record<string, string>;
};

export type Adapter = {
  parse(text: string, options: { file: string; read: IncludeReader }): Parsed<unknown>;
  apply(parsed: Parsed<unknown>, operation: Operation): Result<Applied, OperationError>;
};

const GITLAB: Adapter = {
  parse: (text, options) => parseGitlab(text, options),
  apply: (parsed, operation) => applyGitlab(parsed.document as never, operation),
};

const GITHUB: Adapter = {
  parse: (text, options) => parseGithub(text, options),
  apply: (parsed, operation) => applyGithub(parsed.document as never, operation),
};

const directoryOf = (file: string): string =>
  file.replaceAll("\\", "/").split("/").slice(0, -1).join("/");

const underWorkflows = (directory: string): boolean =>
  directory === WORKFLOWS_DIR || directory.endsWith(`/${WORKFLOWS_DIR}`);

/** A file below `.github/workflows/<dir>/`: GitHub ignores it, and it is not GitLab CI either. */
export function isNestedWorkflow(file: string): boolean {
  const directory = directoryOf(file);
  return (
    !underWorkflows(directory) &&
    (directory.startsWith(`${WORKFLOWS_DIR}/`) || directory.includes(`/${WORKFLOWS_DIR}/`))
  );
}

export function adapterFor(file: string): Adapter {
  return underWorkflows(directoryOf(file)) || isNestedWorkflow(file) ? GITHUB : GITLAB;
}
