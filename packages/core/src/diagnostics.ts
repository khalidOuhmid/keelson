import type { SourceRange } from "./ir.ts";
import type { DiagnosticCode, ParamsOf } from "./messages/codes.ts";

export type Severity = "error" | "warning" | "info";

/** Union discriminée sur `code` : la forme des `params` dépend du code, et le compilateur refuse
 *  d'apparier les deux au hasard. Pas de `message` — le texte est rendu par
 *  `@keelson/core/messages`, jamais produit ici. */
export type Diagnostic = {
  [C in DiagnosticCode]: {
    code: C;
    severity: Severity;
    params: ParamsOf<C>;
    range: SourceRange | null;
  };
}[DiagnosticCode];

export type { DiagnosticCode } from "./messages/codes.ts";
export {
  DIAGNOSTIC_CODES,
  EXTENDS_CYCLE,
  EXTENDS_TARGET_NOT_FOUND,
  INCLUDE_UNRESOLVED,
  INVALID_YAML,
  JOB_WITHOUT_SCRIPT,
  NEED_LATER_STAGE,
  NEEDS_CYCLE,
  UNKNOWN_NEED,
  UNKNOWN_STAGE,
} from "./messages/codes.ts";

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
