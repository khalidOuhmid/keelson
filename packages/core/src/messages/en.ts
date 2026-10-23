import type { MessageCode, ParamsOf } from "./codes.ts";

/** Un code dont les `params` portent un `reason` se rend par une table de branches, pas par une
 *  fonction unique : la table rend l'exhaustivité des branches vérifiable à la compilation, et sa
 *  forme à l'exécution est ce que le test de couverture parcourt. Les deux ne peuvent pas dériver. */
export type Renderer<C extends MessageCode> =
  ParamsOf<C> extends { reason: string }
    ? { [R in ParamsOf<C>["reason"]]: (params: Extract<ParamsOf<C>, { reason: R }>) => string }
    : (params: ParamsOf<C>) => string;

export type Catalogue = { [C in MessageCode]: Renderer<C> };

const quoted = (value: string): string => `"${value}"`;

const chain = (names: readonly string[]): string => names.join(" → ");

export const EN: Catalogue = {
  // `detail` est la phrase de la lib `yaml`, déjà en anglais et plus précise que toute reformulation.
  INVALID_YAML: (p) => p.detail,
  INCLUDE_UNRESOLVED: () =>
    "includes are not resolved: the pipeline shown contains only this local file",
  EXTENDS_TARGET_NOT_FOUND: (p) =>
    `extends target ${quoted(p.template)} does not exist in this file`,
  EXTENDS_CYCLE: (p) => `extends cycle: ${chain(p.trail)}`,
  JOB_WITHOUT_SCRIPT: (p) => `job ${quoted(p.job)} has no script, no run and no trigger`,
  UNKNOWN_NEED: (p) => `job ${quoted(p.job)} needs ${quoted(p.need)}, which does not exist`,
  NEEDS_CYCLE: (p) => `needs cycle: ${chain(p.cycle)}`,
  UNKNOWN_STAGE: (p) =>
    `job ${quoted(p.job)} references stage ${quoted(p.stage)}, which is not declared`,
  NEED_LATER_STAGE: (p) =>
    `job ${quoted(p.job)} (stage ${quoted(p.stage)}) needs ${quoted(p.need)}, which is in the later stage ${quoted(p.needStage)}`,

  STALE_DOCUMENT: () => "the document changed since the operation was computed",
  JOB_NOT_FOUND: (p) => `job ${quoted(p.job)} does not exist in this file`,
  JOB_REFERENCED: (p) => `job ${quoted(p.job)} is needed by ${p.referencedBy.join(", ")}`,
  NAME_CONFLICT: (p) => `key ${quoted(p.name)} already exists in this file`,
  INVALID_NAME: {
    job: (p) => `${quoted(p.name)} is not a usable job name`,
    stage: () => "a stage name cannot be empty",
  },
  STAGE_NOT_FOUND: (p) => `stage ${quoted(p.stage)} is not declared`,
  STAGE_EXISTS: (p) => `stage ${quoted(p.stage)} already exists`,
  NEED_EXISTS: (p) => `job ${quoted(p.job)} already needs ${quoted(p.need)}`,
  NEED_NOT_FOUND: (p) => `job ${quoted(p.job)} does not need ${quoted(p.need)}`,
  CYCLE: (p) => `operation ${p.operation} would create a cycle in needs`,
  UNSUPPORTED_VERSION: (p) =>
    `operation version ${p.received} is not supported, expected ${p.supported}`,
  INVALID_OPERATION: {
    notAnObject: () => "an operation must be a JSON object",
    // `detail` vient de zod, en anglais. `path` le situe dans l'opération reçue.
    schema: (p) => (p.path === "" ? p.detail : `${p.path}: ${p.detail}`),
    flowStyleJob: (p) =>
      `job ${quoted(p.job)} is written in flow style, in-place editing is not supported`,
    jobWithoutScript: () => "an added job must have at least one script line",
    inheritedEnvironment: (p) =>
      `the environment of ${quoted(p.job)} is inherited (${p.origin}) and cannot be removed locally`,
    noRootMap: () => "this file has no YAML map at its root",
    wouldBreakYaml: (p) =>
      `operation ${p.operation} would produce invalid YAML, nothing was written`,
    unreadableBody: () => "request body is not readable JSON",
    missingOpId: () => "opId is missing or empty",
    missingOp: () => "op is missing or invalid",
  },
  RANGE_OUT_OF_BOUNDS: {
    jobRange: (p) => `no source range found for job ${quoted(p.job)}`,
    stageKey: () => "no source range found for the stage key",
    needsKey: () => "no source range found for the needs key",
    lastNeed: () => "no source range found for the last need",
    environmentKey: () => "no source range found for the environment key",
    stageList: () => "no source range found in the stage list",
    emptyStageList: () => "the stage list is empty",
    stageIndex: (p) => `index ${p.index} is outside a list of ${p.count} stages`,
    textRange: (p) => `range [${p.start}, ${p.end}) is outside a text of ${p.length} characters`,
  },

  FORBIDDEN_HOST: () => "the local server refused the Host header",
  FORBIDDEN_TOKEN: () => "the session token is missing or invalid",
  METHOD_NOT_ALLOWED: (p) => `method ${p.method} is not allowed`,
  NOT_FOUND: {
    unreadableFileName: () => "the file name cannot be decoded",
    unknownFile: (p) => `unknown file: ${p.file}`,
    missingFile: (p) => `file not found: ${p.file}`,
    unknownRoute: (p) => `unknown route: ${p.route}`,
    noUiBundle: () => "this server does not serve an interface bundle",
  },
  PAYLOAD_TOO_LARGE: (p) => `request body is larger than ${p.limitBytes} bytes`,
  INTERNAL_ERROR: () => "internal server error",

  NETWORK_ERROR: (p) => `network error: ${p.detail}`,
  UNEXPECTED_RESPONSE: () => "unexpected server response",
};
