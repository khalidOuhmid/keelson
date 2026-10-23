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

export const STALE_DOCUMENT = "STALE_DOCUMENT";
export const JOB_NOT_FOUND = "JOB_NOT_FOUND";
export const JOB_REFERENCED = "JOB_REFERENCED";
export const NAME_CONFLICT = "NAME_CONFLICT";
export const INVALID_NAME = "INVALID_NAME";
export const STAGE_NOT_FOUND = "STAGE_NOT_FOUND";
export const STAGE_EXISTS = "STAGE_EXISTS";
export const NEED_EXISTS = "NEED_EXISTS";
export const NEED_NOT_FOUND = "NEED_NOT_FOUND";
export const CYCLE = "CYCLE";
export const UNSUPPORTED_VERSION = "UNSUPPORTED_VERSION";
export const INVALID_OPERATION = "INVALID_OPERATION";
export const RANGE_OUT_OF_BOUNDS = "RANGE_OUT_OF_BOUNDS";

export const OPERATION_ERROR_CODES = [
  STALE_DOCUMENT,
  JOB_NOT_FOUND,
  JOB_REFERENCED,
  NAME_CONFLICT,
  INVALID_NAME,
  STAGE_NOT_FOUND,
  STAGE_EXISTS,
  NEED_EXISTS,
  NEED_NOT_FOUND,
  CYCLE,
  UNSUPPORTED_VERSION,
  INVALID_OPERATION,
  RANGE_OUT_OF_BOUNDS,
] as const;

export const FORBIDDEN_HOST = "FORBIDDEN_HOST";
export const FORBIDDEN_TOKEN = "FORBIDDEN_TOKEN";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const NOT_FOUND = "NOT_FOUND";
export const PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";
export const INTERNAL_ERROR = "INTERNAL_ERROR";

/** Codes du transport HTTP, propres à `@keelson/server`. Ils entrent au registre pour la même
 *  raison que les autres : l'UI les reçoit et doit pouvoir les rendre. */
export const TRANSPORT_CODES = [
  FORBIDDEN_HOST,
  FORBIDDEN_TOKEN,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  PAYLOAD_TOO_LARGE,
  INTERNAL_ERROR,
] as const;

export const NETWORK_ERROR = "NETWORK_ERROR";
export const UNEXPECTED_RESPONSE = "UNEXPECTED_RESPONSE";

/** Codes que le client forge lui-même quand la réponse n'arrive pas, ou n'a pas la forme attendue.
 *  Aucun serveur ne les émet. */
export const CLIENT_CODES = [NETWORK_ERROR, UNEXPECTED_RESPONSE] as const;

export const MESSAGE_CODES = [
  ...DIAGNOSTIC_CODES,
  ...OPERATION_ERROR_CODES,
  ...TRANSPORT_CODES,
  ...CLIENT_CODES,
] as const;

type Empty = Record<string, never>;

/** La forme des `params` de chaque code. C'est un contrat public au même titre que le code :
 *  en changer la forme est une rupture de compatibilité. Documenté dans `specs/diagnostics.md`.
 *
 *  Là où un code couvre plusieurs situations distinctes, les `params` portent un discriminant
 *  `reason`. Le rendu branche dessus, et l'exhaustivité des branches est garantie à la compilation
 *  par la forme de `en.ts`. */
export type MessageParams = {
  INVALID_YAML: { detail: string };
  INCLUDE_UNRESOLVED: Empty;
  EXTENDS_TARGET_NOT_FOUND: { template: string };
  EXTENDS_CYCLE: { trail: readonly string[] };
  JOB_WITHOUT_SCRIPT: { job: string };
  UNKNOWN_NEED: { job: string; need: string };
  NEEDS_CYCLE: { cycle: readonly string[] };
  UNKNOWN_STAGE: { job: string; stage: string };
  NEED_LATER_STAGE: { job: string; stage: string; need: string; needStage: string };

  STALE_DOCUMENT: { expected: string; received: string };
  JOB_NOT_FOUND: { job: string };
  JOB_REFERENCED: { job: string; referencedBy: readonly string[] };
  NAME_CONFLICT: { name: string };
  INVALID_NAME: { reason: "job"; name: string } | { reason: "stage" };
  STAGE_NOT_FOUND: { stage: string };
  STAGE_EXISTS: { stage: string };
  NEED_EXISTS: { job: string; need: string };
  NEED_NOT_FOUND: { job: string; need: string };
  CYCLE: { operation: string };
  UNSUPPORTED_VERSION: { received: number; supported: number };
  INVALID_OPERATION:
    | { reason: "notAnObject" }
    | { reason: "schema"; path: string; detail: string }
    | { reason: "flowStyleJob"; job: string }
    | { reason: "jobWithoutScript" }
    | { reason: "inheritedEnvironment"; job: string; origin: string }
    | { reason: "noRootMap" }
    | { reason: "wouldBreakYaml"; operation: string }
    | { reason: "unreadableBody" }
    | { reason: "missingOpId" }
    | { reason: "missingOp" };
  RANGE_OUT_OF_BOUNDS:
    | { reason: "jobRange"; job: string }
    | { reason: "stageKey" }
    | { reason: "needsKey" }
    | { reason: "lastNeed" }
    | { reason: "environmentKey" }
    | { reason: "stageList" }
    | { reason: "emptyStageList" }
    | { reason: "stageIndex"; index: number; count: number }
    | { reason: "textRange"; start: number; end: number; length: number };

  FORBIDDEN_HOST: Empty;
  FORBIDDEN_TOKEN: Empty;
  METHOD_NOT_ALLOWED: { method: string };
  NOT_FOUND:
    | { reason: "unreadableFileName" }
    | { reason: "unknownFile"; file: string }
    | { reason: "missingFile"; file: string }
    | { reason: "unknownRoute"; route: string }
    | { reason: "noUiBundle" };
  PAYLOAD_TOO_LARGE: { limitBytes: number };
  INTERNAL_ERROR: Empty;

  NETWORK_ERROR: { detail: string };
  UNEXPECTED_RESPONSE: Empty;
};

export type MessageCode = keyof MessageParams;

export type ParamsOf<C extends MessageCode> = MessageParams[C];

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];
export type TransportCode = (typeof TRANSPORT_CODES)[number];
export type ClientCode = (typeof CLIENT_CODES)[number];

/** Les quatre familles couvrent exactement `MessageParams`, sans trou ni doublon. Vérifié ici
 *  plutôt que par un test : un code sans forme de `params` ne doit pas compiler. */
type Partitioned = DiagnosticCode | OperationErrorCode | TransportCode | ClientCode;
type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const MESSAGE_CODES_ARE_PARTITIONED: AssertSame<MessageCode, Partitioned> = true;
