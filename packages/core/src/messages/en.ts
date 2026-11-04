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
  // Seuls les includes **distants** restent non résolus : les locaux le sont depuis le lot L2b.
  INCLUDE_UNRESOLVED: (p) =>
    `this ${p.form} include is not resolved (${p.detail}), so the pipeline shown may be incomplete`,
  INCLUDE_NOT_FOUND: {
    missing: (p) => `included file ${quoted(p.path)} does not exist`,
    notYaml: (p) => `included file ${quoted(p.path)} is not a .yml or .yaml file`,
    // GitLab exige un chemin depuis la racine du dépôt. Un chemin qui en sort est refusé avant
    // toute lecture : le serveur lit le disque pour le compte d'une page web.
    outsideRoot: (p) => `included path ${quoted(p.path)} leaves the repository root`,
    malformed: () => "this include entry has no form Keelson understands",
  },
  INCLUDE_CYCLE: (p) => `include cycle: ${chain(p.trail)}`,
  INCLUDE_LIMIT_EXCEEDED: (p) =>
    `more than ${p.limit} included files, include resolution stopped there`,
  EXTENDS_TARGET_NOT_FOUND: (p) =>
    `extends target ${quoted(p.template)} does not exist in any resolved file`,
  EXTENDS_CYCLE: (p) => `extends cycle: ${chain(p.trail)}`,
  JOB_WITHOUT_SCRIPT: (p) => `job ${quoted(p.job)} has no script, no run and no trigger`,
  UNKNOWN_NEED: (p) => `job ${quoted(p.job)} needs ${quoted(p.need)}, which does not exist`,
  NEEDS_CYCLE: (p) => `needs cycle: ${chain(p.cycle)}`,
  UNKNOWN_STAGE: (p) =>
    `job ${quoted(p.job)} references stage ${quoted(p.stage)}, which is not declared`,
  NEED_LATER_STAGE: (p) =>
    `job ${quoted(p.job)} (stage ${quoted(p.stage)}) needs ${quoted(p.need)}, which is in the later stage ${quoted(p.needStage)}`,
  LAYOUT_INVALID: (p) => `.devsecops/layout.json is not usable: ${p.detail}`,
  LAYOUT_UNKNOWN_LAYER: (p) =>
    `layout.json assigns job ${quoted(p.job)} to unknown layer ${quoted(p.layer)}`,
  LAYOUT_UNKNOWN_JOB: (p) => `layout.json names job ${quoted(p.job)}, which does not exist`,
  COVERAGE_LAYER_MISSING: (p) => `required layer ${quoted(p.layer)} (${p.name}) is not covered`,
  // `detail` vient de zod ou de `yaml`, en anglais.
  CATALOG_INVALID_TOOL: (p) => `invalid tool file: ${p.detail}`,
  CATALOG_DUPLICATE_TOOL: (p) => `tool id ${quoted(p.tool)} is declared twice`,
  CATALOG_UNKNOWN_LOGO: (p) => `tool ${quoted(p.tool)} names unknown logo ${quoted(p.logo)}`,
  CATALOG_MISSING_SNIPPET: (p) => `job tool ${quoted(p.tool)} has no snippet`,
  CATALOG_STALE_TOOL: (p) =>
    `tool ${quoted(p.tool)} was last verified on ${p.lastVerified}, more than six months ago`,
  // `detail` vient de `yaml` ou de zod, en anglais.
  TOOLCHAIN_INVALID: (p) => `.devsecops/toolchain.yaml is not usable: ${p.detail}`,
  TOOLCHAIN_UNKNOWN_TOOL: (p) =>
    `service ${quoted(p.service)} names ${quoted(p.tool)}, which is not in the catalog`,
  TOOLCHAIN_UNKNOWN_SERVICE: (p) =>
    `job ${quoted(p.job)} is integrated with ${quoted(p.service)}, which is not a declared service`,
  TOOLCHAIN_UNKNOWN_JOB: (p) => `toolchain.yaml names job ${quoted(p.job)}, which does not exist`,
  TOOLCHAIN_DUPLICATE_INTEGRATION: (p) =>
    `the ${p.kind} integration of ${quoted(p.job)} with ${quoted(p.service)} is listed twice`,

  STALE_DOCUMENT: () => "the document changed since the operation was computed",
  JOB_NOT_FOUND: (p) => `job ${quoted(p.job)} does not exist in this file`,
  JOB_REFERENCED: (p) => `job ${quoted(p.job)} is needed by ${p.referencedBy.join(", ")}`,
  NAME_CONFLICT: (p) => `key ${quoted(p.name)} already exists in this file`,
  INVALID_NAME: {
    job: (p) => `${quoted(p.name)} is not a usable job name`,
    stage: () => "a stage name cannot be empty",
    service: (p) => `${quoted(p.name)} is not a usable service name`,
  },
  STAGE_NOT_FOUND: (p) => `stage ${quoted(p.stage)} is not declared`,
  STAGE_EXISTS: (p) => `stage ${quoted(p.stage)} already exists`,
  NEED_EXISTS: (p) => `job ${quoted(p.job)} already needs ${quoted(p.need)}`,
  NEED_NOT_FOUND: {
    notNeeded: (p) => `job ${quoted(p.job)} does not need ${quoted(p.need)}`,
    // Ce chemin n'est atteint qu'après avoir établi que le need *est* dans la valeur effective,
    // mais que la liste locale n'est pas une séquence lisible item par item — un alias d'anchor ou
    // un `!reference`. Dire « does not need » y énoncerait l'inverse de la condition qui y mène.
    notLocal: (p) =>
      `job ${quoted(p.job)} needs ${quoted(p.need)} through an anchor or a !reference, so removing it would mean rewriting that shared list`,
  },
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
    sharedValue: (p) =>
      `the ${p.key} of ${quoted(p.job)} comes through an anchor or a !reference that Keelson cannot rewrite in place`,
    flowStyleToolchain: (p) =>
      `the ${p.section} section is written in flow style, in-place editing is not supported`,
    invalidToolchain: () => "toolchain.yaml is not usable, fix it before editing it here",
    invalidLayout: () => "layout.json is not usable, fix it before moving nodes",
    outsideRoot: (p) => `${quoted(p.path)} leads outside the repository, nothing was written`,
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
  FROM_INCLUDED_FILE: {
    job: (p) =>
      `job ${quoted(p.job)} comes from included file ${quoted(p.file)}, which Keelson never writes`,
    stages: (p) =>
      `the stage list comes from included file ${quoted(p.file)}, which Keelson never writes`,
    nameTaken: (p) =>
      `the name ${quoted(p.name)} is already used in included file ${quoted(p.file)}`,
    referencedByInclude: (p) =>
      `job ${quoted(p.job)} is needed by ${p.referencedBy.map((entry) => `${entry.job} in ${entry.file}`).join(", ")}, and Keelson never writes an included file`,
  },
  SERVICE_NOT_FOUND: (p) => `service ${quoted(p.service)} is not declared`,
  SERVICE_REFERENCED: (p) => `service ${quoted(p.service)} is integrated with ${p.jobs.join(", ")}`,
  INTEGRATION_EXISTS: (p) =>
    `the ${p.kind} integration of ${quoted(p.job)} with ${quoted(p.target)} already exists`,
  INTEGRATION_NOT_FOUND: (p) =>
    `the ${p.kind} integration of ${quoted(p.job)} with ${quoted(p.target)} does not exist`,

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
