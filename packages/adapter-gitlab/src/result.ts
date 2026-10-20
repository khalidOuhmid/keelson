import type { Diagnostic, OperationErrorCode, Pipeline, SpliceOperation } from "@keelson/core";
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
};

export type SourceRangeList = { start: number; end: number }[];

export type ApplyError = {
  code: OperationErrorCode;
  message: string;
  details?: Record<string, unknown>;
};
