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
};

export type SourceRangeList = { start: number; end: number }[];

/** L'adaptateur n'ajoute rien à l'erreur de `core` : il la rend telle quelle. L'alias reste pour
 *  que les signatures de ce paquet nomment ce qu'elles rendent. */
export type ApplyError = OperationError;
