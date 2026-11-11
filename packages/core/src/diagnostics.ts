import type { SourceRange } from "./ir.ts";
import type { DiagnosticCode, ParamsOf } from "./messages/codes.ts";

export type Severity = "error" | "warning" | "info";

/** Discriminated union on `code`: the shape of `params` depends on the code, and the compiler
 *  refuses to pair the two at random. No `message` — the text is rendered by
 *  `@keelson/core/messages`, never produced here. */
export type Diagnostic = {
  [C in DiagnosticCode]: {
    code: C;
    severity: Severity;
    params: ParamsOf<C>;
    /** Offset into the text of `file`, not into that of the main file. */
    range: SourceRange | null;
    /** Always present. An `undefined` meaning "the main file" would be exactly the missing value
     *  that milestone L2c spent its day removing from the renderings. */
    file: string;
  };
}[DiagnosticCode];

export type { DiagnosticCode } from "./messages/codes.ts";
export {
  CATALOG_DUPLICATE_TOOL,
  CATALOG_INVALID_TOOL,
  CATALOG_MISSING_SNIPPET,
  CATALOG_STALE_TOOL,
  CATALOG_UNKNOWN_LOGO,
  COVERAGE_LAYER_MISSING,
  DIAGNOSTIC_CODES,
  EXTENDS_CYCLE,
  EXTENDS_TARGET_NOT_FOUND,
  INCLUDE_CYCLE,
  INCLUDE_LIMIT_EXCEEDED,
  INCLUDE_NOT_FOUND,
  INCLUDE_UNRESOLVED,
  INVALID_YAML,
  JOB_WITHOUT_SCRIPT,
  LAYOUT_INVALID,
  LAYOUT_UNKNOWN_JOB,
  LAYOUT_UNKNOWN_LAYER,
  NEED_LATER_STAGE,
  NEEDS_CYCLE,
  TOOLCHAIN_DUPLICATE_INTEGRATION,
  TOOLCHAIN_INVALID,
  TOOLCHAIN_UNKNOWN_JOB,
  TOOLCHAIN_UNKNOWN_SERVICE,
  TOOLCHAIN_UNKNOWN_TOOL,
  UNKNOWN_NEED,
  UNKNOWN_STAGE,
  WORKFLOW_UNRESOLVED,
} from "./messages/codes.ts";

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
