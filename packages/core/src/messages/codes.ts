export const INVALID_YAML = "INVALID_YAML";
export const INCLUDE_UNRESOLVED = "INCLUDE_UNRESOLVED";
export const WORKFLOW_UNRESOLVED = "WORKFLOW_UNRESOLVED";
export const WORKFLOW_CALL_INVALID = "WORKFLOW_CALL_INVALID";
export const WORKFLOW_JOB_INVALID = "WORKFLOW_JOB_INVALID";
export const INCLUDE_NOT_FOUND = "INCLUDE_NOT_FOUND";
export const INCLUDE_CYCLE = "INCLUDE_CYCLE";
export const INCLUDE_LIMIT_EXCEEDED = "INCLUDE_LIMIT_EXCEEDED";
export const EXTENDS_TARGET_NOT_FOUND = "EXTENDS_TARGET_NOT_FOUND";
export const EXTENDS_CYCLE = "EXTENDS_CYCLE";
export const EXTENDS_DEPTH_EXCEEDED = "EXTENDS_DEPTH_EXCEEDED";
export const VALUE_CYCLE = "VALUE_CYCLE";
export const JOB_WITHOUT_SCRIPT = "JOB_WITHOUT_SCRIPT";
export const UNKNOWN_NEED = "UNKNOWN_NEED";
export const NEEDS_CYCLE = "NEEDS_CYCLE";
export const UNKNOWN_STAGE = "UNKNOWN_STAGE";
export const NEED_LATER_STAGE = "NEED_LATER_STAGE";
export const LAYOUT_INVALID = "LAYOUT_INVALID";
export const LAYOUT_UNKNOWN_LAYER = "LAYOUT_UNKNOWN_LAYER";
export const LAYOUT_UNKNOWN_JOB = "LAYOUT_UNKNOWN_JOB";
export const LAYOUT_UNREAD_JOB = "LAYOUT_UNREAD_JOB";
export const COVERAGE_LAYER_MISSING = "COVERAGE_LAYER_MISSING";
export const CATALOG_INVALID_TOOL = "CATALOG_INVALID_TOOL";
export const CATALOG_DUPLICATE_TOOL = "CATALOG_DUPLICATE_TOOL";
export const CATALOG_UNKNOWN_LOGO = "CATALOG_UNKNOWN_LOGO";
export const CATALOG_MISSING_SNIPPET = "CATALOG_MISSING_SNIPPET";
export const CATALOG_STALE_TOOL = "CATALOG_STALE_TOOL";
export const CATALOG_FUTURE_VERIFIED = "CATALOG_FUTURE_VERIFIED";
export const TOOLCHAIN_INVALID = "TOOLCHAIN_INVALID";
export const TOOLCHAIN_UNKNOWN_TOOL = "TOOLCHAIN_UNKNOWN_TOOL";
export const TOOLCHAIN_UNKNOWN_SERVICE = "TOOLCHAIN_UNKNOWN_SERVICE";
export const TOOLCHAIN_UNKNOWN_JOB = "TOOLCHAIN_UNKNOWN_JOB";
export const TOOLCHAIN_DUPLICATE_INTEGRATION = "TOOLCHAIN_DUPLICATE_INTEGRATION";
export const TOOLCHAIN_JOB_TOOL_AS_SERVICE = "TOOLCHAIN_JOB_TOOL_AS_SERVICE";

export const DIAGNOSTIC_CODES = [
  INVALID_YAML,
  INCLUDE_UNRESOLVED,
  WORKFLOW_UNRESOLVED,
  WORKFLOW_CALL_INVALID,
  WORKFLOW_JOB_INVALID,
  INCLUDE_NOT_FOUND,
  INCLUDE_CYCLE,
  INCLUDE_LIMIT_EXCEEDED,
  EXTENDS_TARGET_NOT_FOUND,
  EXTENDS_CYCLE,
  EXTENDS_DEPTH_EXCEEDED,
  VALUE_CYCLE,
  JOB_WITHOUT_SCRIPT,
  UNKNOWN_NEED,
  NEEDS_CYCLE,
  UNKNOWN_STAGE,
  NEED_LATER_STAGE,
  LAYOUT_INVALID,
  LAYOUT_UNKNOWN_LAYER,
  LAYOUT_UNKNOWN_JOB,
  LAYOUT_UNREAD_JOB,
  COVERAGE_LAYER_MISSING,
  CATALOG_INVALID_TOOL,
  CATALOG_DUPLICATE_TOOL,
  CATALOG_UNKNOWN_LOGO,
  CATALOG_MISSING_SNIPPET,
  CATALOG_STALE_TOOL,
  CATALOG_FUTURE_VERIFIED,
  TOOLCHAIN_INVALID,
  TOOLCHAIN_UNKNOWN_TOOL,
  TOOLCHAIN_UNKNOWN_SERVICE,
  TOOLCHAIN_UNKNOWN_JOB,
  TOOLCHAIN_DUPLICATE_INTEGRATION,
  TOOLCHAIN_JOB_TOOL_AS_SERVICE,
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
export const FROM_INCLUDED_FILE = "FROM_INCLUDED_FILE";
export const SERVICE_NOT_FOUND = "SERVICE_NOT_FOUND";
export const SERVICE_REFERENCED = "SERVICE_REFERENCED";
export const INTEGRATION_EXISTS = "INTEGRATION_EXISTS";
export const INTEGRATION_NOT_FOUND = "INTEGRATION_NOT_FOUND";

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
  FROM_INCLUDED_FILE,
  SERVICE_NOT_FOUND,
  SERVICE_REFERENCED,
  INTEGRATION_EXISTS,
  INTEGRATION_NOT_FOUND,
] as const;

export const FORBIDDEN_HOST = "FORBIDDEN_HOST";
export const FORBIDDEN_TOKEN = "FORBIDDEN_TOKEN";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const NOT_FOUND = "NOT_FOUND";
export const PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";
export const INTERNAL_ERROR = "INTERNAL_ERROR";

/** HTTP transport codes, specific to `@keelson/server`. They join the registry for the same reason
 *  as the others: the UI receives them and must be able to render them. */
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

/** Codes the client forges itself when the response does not arrive, or does not have the
 *  expected shape. No server emits them. */
export const CLIENT_CODES = [NETWORK_ERROR, UNEXPECTED_RESPONSE] as const;

export const MESSAGE_CODES = [
  ...DIAGNOSTIC_CODES,
  ...OPERATION_ERROR_CODES,
  ...TRANSPORT_CODES,
  ...CLIENT_CODES,
] as const;

type Empty = Record<string, never>;

/** The shape of each code's `params`. It is a public contract just like the code: changing the
 *  shape is a breaking change. Documented in `specs/diagnostics.md`.
 *
 *  Where a code covers several distinct situations, the `params` carry a `reason` discriminant.
 *  Rendering branches on it, and branch exhaustiveness is guaranteed at compile time by the shape
 *  of `en.ts`. */
export type MessageParams = {
  INVALID_YAML: { detail: string };
  INCLUDE_UNRESOLVED: {
    form: "local" | "remote" | "project" | "template" | "component" | "workflow";
    detail: string;
  };
  WORKFLOW_UNRESOLVED: { job: string; target: string };
  WORKFLOW_CALL_INVALID:
    | { reason: "missing"; job: string; path: string }
    | { reason: "outsideRoot"; job: string; path: string }
    | { reason: "notInWorkflows"; job: string; path: string }
    | { reason: "cycle"; job: string; trail: string[] }
    | { reason: "depth"; job: string; path: string; limit: number }
    | { reason: "limit"; job: string; path: string; limit: number };
  WORKFLOW_JOB_INVALID: { reason: "notMap"; job: string } | { reason: "needs"; job: string };
  INCLUDE_NOT_FOUND:
    | { reason: "missing"; path: string }
    | { reason: "notYaml"; path: string }
    | { reason: "outsideRoot"; path: string }
    | { reason: "malformed" };
  INCLUDE_CYCLE: { trail: readonly string[] };
  INCLUDE_LIMIT_EXCEEDED: { limit: number };
  EXTENDS_TARGET_NOT_FOUND: { template: string };
  EXTENDS_CYCLE: { trail: readonly string[] };
  EXTENDS_DEPTH_EXCEEDED: { job: string; limit: number };
  VALUE_CYCLE: { job: string; key: string };
  JOB_WITHOUT_SCRIPT: { job: string };
  UNKNOWN_NEED: { job: string; need: string };
  NEEDS_CYCLE: { cycle: readonly string[] };
  UNKNOWN_STAGE: { job: string; stage: string };
  NEED_LATER_STAGE: { job: string; stage: string; need: string; needStage: string };
  LAYOUT_INVALID: { detail: string };
  LAYOUT_UNKNOWN_LAYER: { job: string; layer: string };
  LAYOUT_UNKNOWN_JOB: { job: string };
  LAYOUT_UNREAD_JOB: { job: string };
  COVERAGE_LAYER_MISSING: { layer: string; name: string };
  CATALOG_INVALID_TOOL: { detail: string };
  CATALOG_DUPLICATE_TOOL: { tool: string };
  CATALOG_UNKNOWN_LOGO: { tool: string; logo: string };
  CATALOG_MISSING_SNIPPET: { tool: string };
  CATALOG_STALE_TOOL: { tool: string; lastVerified: string };
  CATALOG_FUTURE_VERIFIED: { tool: string; lastVerified: string };
  TOOLCHAIN_INVALID: { detail: string };
  TOOLCHAIN_UNKNOWN_TOOL: { service: string; tool: string };
  TOOLCHAIN_UNKNOWN_SERVICE: { job: string; service: string };
  TOOLCHAIN_UNKNOWN_JOB: { job: string };
  TOOLCHAIN_DUPLICATE_INTEGRATION: { job: string; service: string; kind: string };
  TOOLCHAIN_JOB_TOOL_AS_SERVICE: { service: string; tool: string };

  STALE_DOCUMENT: { expected: string; received: string };
  JOB_NOT_FOUND: { job: string };
  JOB_REFERENCED: { job: string; referencedBy: readonly string[] };
  NAME_CONFLICT: { name: string };
  INVALID_NAME:
    | { reason: "job"; name: string }
    | { reason: "stage" }
    | { reason: "service"; name: string };
  STAGE_NOT_FOUND: { stage: string };
  STAGE_EXISTS: { stage: string };
  NEED_EXISTS: { job: string; need: string };
  NEED_NOT_FOUND:
    | { reason: "notNeeded"; job: string; need: string }
    | { reason: "notLocal"; job: string; need: string };
  CYCLE: { operation: string };
  UNSUPPORTED_VERSION: { received: number; supported: number };
  INVALID_OPERATION:
    | { reason: "notAnObject" }
    | { reason: "schema"; path: string; detail: string }
    | { reason: "flowStyleJob"; job: string }
    | { reason: "jobWithoutScript" }
    | { reason: "sharedValue"; job: string; key: string }
    | { reason: "flowStyleToolchain"; section: string }
    | { reason: "invalidToolchain" }
    | { reason: "invalidLayout" }
    | { reason: "invalidSnippet" }
    | { reason: "notForProvider"; operation: string }
    | { reason: "citedInExpression"; job: string }
    | { reason: "dynamicExpression"; job: string }
    | { reason: "readsOwnId"; job: string }
    | { reason: "outsideRoot"; path: string }
    | { reason: "notADirectory"; path: string }
    | { reason: "noRootMap" }
    | { reason: "notUtf8"; file: string }
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
  FROM_INCLUDED_FILE:
    | { reason: "job"; job: string; file: string }
    | { reason: "stages"; file: string }
    | { reason: "nameTaken"; name: string; file: string }
    | {
        reason: "referencedByInclude";
        job: string;
        referencedBy: readonly { job: string; file: string }[];
      };

  SERVICE_NOT_FOUND: { service: string };
  SERVICE_REFERENCED: { service: string; jobs: readonly string[] };
  INTEGRATION_EXISTS: { job: string; target: string; kind: string };
  INTEGRATION_NOT_FOUND: { job: string; target: string; kind: string };

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

/** The four families cover exactly `MessageParams`, with no gap and no duplicate. Checked here
 *  rather than by a test: a code without a `params` shape must not compile. */
type Partitioned = DiagnosticCode | OperationErrorCode | TransportCode | ClientCode;
type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const MESSAGE_CODES_ARE_PARTITIONED: AssertSame<MessageCode, Partitioned> = true;
