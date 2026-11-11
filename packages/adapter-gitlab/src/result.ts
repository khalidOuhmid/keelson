import type { Diagnostic, OperationError, Pipeline, SpliceOperation } from "@keelson/core";
import type { GitlabDocument } from "./document.ts";

export { err, ok, type Result } from "@keelson/core";

export type ApplyOk = {
  text: string;
  document: GitlabDocument;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  inverse: SpliceOperation;
  touched: SourceRangeList;
  /** The text of each included file after the operation: the ranges of an included job's opaque
   *  blocks are offsets into it. */
  included: Record<string, string>;
};

export type SourceRangeList = { start: number; end: number }[];

/** The adapter adds nothing to `core`'s error: it returns it as is. The alias remains so that this
 *  package's signatures name what they return. */
export type ApplyError = OperationError;
