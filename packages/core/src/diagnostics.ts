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
    /** Offset dans le texte de `file`, pas dans celui du fichier principal. */
    range: SourceRange | null;
    /** Toujours présent. Un `undefined` qui voudrait dire « le fichier principal » serait
     *  exactement la valeur absente que le lot L2c a passé sa journée à retirer des rendus. */
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
  UNKNOWN_NEED,
  UNKNOWN_STAGE,
} from "./messages/codes.ts";

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
