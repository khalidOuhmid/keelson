import type { SourceRange } from "./ir.ts";

export type Severity = "error" | "warning" | "info";

export type Diagnostic = {
  code: string;
  severity: Severity;
  message: string;
  range: SourceRange | null;
};

export const INVALID_YAML = "INVALID_YAML";
export const INCLUDE_UNRESOLVED = "INCLUDE_UNRESOLVED";
export const EXTENDS_TARGET_NOT_FOUND = "EXTENDS_TARGET_NOT_FOUND";
export const EXTENDS_CYCLE = "EXTENDS_CYCLE";
export const JOB_WITHOUT_SCRIPT = "JOB_WITHOUT_SCRIPT";
export const UNKNOWN_NEED = "UNKNOWN_NEED";
export const NEEDS_CYCLE = "NEEDS_CYCLE";
export const UNKNOWN_STAGE = "UNKNOWN_STAGE";
export const NEED_LATER_STAGE = "NEED_LATER_STAGE";

export const DIAGNOSTIC_CODES = [
  INVALID_YAML,
  INCLUDE_UNRESOLVED,
  EXTENDS_TARGET_NOT_FOUND,
  EXTENDS_CYCLE,
  JOB_WITHOUT_SCRIPT,
  UNKNOWN_NEED,
  NEEDS_CYCLE,
  UNKNOWN_STAGE,
  NEED_LATER_STAGE,
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
