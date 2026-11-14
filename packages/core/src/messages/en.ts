import type { MessageCode, ParamsOf } from "./codes.ts";

/** A code whose `params` carry a `reason` is rendered by a table of branches, not by a single
 *  function: the table makes branch exhaustiveness checkable at compile time, and its runtime
 *  shape is what the coverage test walks. The two cannot drift apart. */
export type Renderer<C extends MessageCode> =
  ParamsOf<C> extends { reason: string }
    ? { [R in ParamsOf<C>["reason"]]: (params: Extract<ParamsOf<C>, { reason: R }>) => string }
    : (params: ParamsOf<C>) => string;

export type Catalogue = { [C in MessageCode]: Renderer<C> };

const quoted = (value: string): string => `"${value}"`;

const chain = (names: readonly string[]): string => names.join(" → ");

export const EN: Catalogue = {
  // `detail` is the `yaml` library's sentence, already in English and more precise than any rewording.
  INVALID_YAML: (p) => p.detail,
  // Only **remote** includes stay unresolved: local ones have been resolved since milestone L2b.
  INCLUDE_UNRESOLVED: (p) =>
    `this ${p.form} include is not resolved (${p.detail}), so the pipeline shown may be incomplete`,
  WORKFLOW_UNRESOLVED: (p) =>
    `job ${quoted(p.job)} calls the reusable workflow ${quoted(p.target)}, which Keelson does not read, so its jobs are not shown`,
  WORKFLOW_CALL_INVALID: {
    missing: (p) =>
      `job ${quoted(p.job)} calls the reusable workflow ${quoted(p.path)}, which does not exist`,
    outsideRoot: (p) =>
      `job ${quoted(p.job)} calls the reusable workflow ${quoted(p.path)}, whose path leaves the repository root`,
    notInWorkflows: (p) =>
      `job ${quoted(p.job)} calls ${quoted(p.path)}, but a reusable workflow is a .yml or .yaml file directly in .github/workflows`,
    cycle: (p) => `job ${quoted(p.job)} closes a reusable workflow cycle: ${chain(p.trail)}`,
    depth: (p) =>
      `job ${quoted(p.job)} calls ${quoted(p.path)} beyond ${p.limit} levels of nested workflows, which GitHub refuses`,
    limit: (p) =>
      `job ${quoted(p.job)} calls ${quoted(p.path)} beyond ${p.limit} unique reusable workflows, which GitHub refuses`,
  },
  WORKFLOW_JOB_INVALID: {
    notMap: (p) =>
      `job ${quoted(p.job)} is not a map of keys, so GitHub refuses the workflow and Keelson does not show it`,
    needs: (p) =>
      `the needs of job ${quoted(p.job)} are neither a job name nor a list of job names, so GitHub refuses the workflow`,
  },
  INCLUDE_NOT_FOUND: {
    missing: (p) => `included file ${quoted(p.path)} does not exist`,
    notYaml: (p) => `included file ${quoted(p.path)} is not a .yml or .yaml file`,
    // GitLab requires a path from the repository root. A path that escapes it is refused before
    // any read: the server reads the disk on behalf of a web page.
    outsideRoot: (p) => `included path ${quoted(p.path)} leaves the repository root`,
    malformed: () => "this include entry has no form Keelson understands",
  },
  INCLUDE_CYCLE: (p) => `include cycle: ${chain(p.trail)}`,
  INCLUDE_LIMIT_EXCEEDED: (p) =>
    `more than ${p.limit} included files, include resolution stopped there`,
  EXTENDS_TARGET_NOT_FOUND: (p) =>
    `extends target ${quoted(p.template)} does not exist in any resolved file`,
  EXTENDS_CYCLE: (p) => `extends cycle: ${chain(p.trail)}`,
  EXTENDS_DEPTH_EXCEEDED: (p) =>
    `job ${quoted(p.job)} inherits through more than ${p.limit} levels of extends, which GitLab refuses`,
  VALUE_CYCLE: (p) =>
    `the ${p.key} of job ${quoted(p.job)} refers to itself through an alias or a !reference`,
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
  LAYOUT_UNREAD_JOB: (p) =>
    `layout.json names job ${quoted(p.job)}, absent from the part of the pipeline Keelson could read: its override is kept`,
  COVERAGE_LAYER_MISSING: (p) => `required layer ${quoted(p.layer)} (${p.name}) is not covered`,
  // `detail` comes from zod or `yaml`, in English.
  CATALOG_INVALID_TOOL: (p) => `invalid tool file: ${p.detail}`,
  CATALOG_DUPLICATE_TOOL: (p) => `tool id ${quoted(p.tool)} is declared twice`,
  CATALOG_UNKNOWN_LOGO: (p) => `tool ${quoted(p.tool)} names unknown logo ${quoted(p.logo)}`,
  CATALOG_MISSING_SNIPPET: (p) => `job tool ${quoted(p.tool)} has no snippet`,
  CATALOG_STALE_TOOL: (p) =>
    `tool ${quoted(p.tool)} was last verified on ${p.lastVerified}, more than six months ago`,
  CATALOG_FUTURE_VERIFIED: (p) =>
    `tool ${quoted(p.tool)} claims a verification on ${p.lastVerified}, which is in the future`,
  // `detail` comes from `yaml` or zod, in English.
  TOOLCHAIN_INVALID: (p) => `.devsecops/toolchain.yaml is not usable: ${p.detail}`,
  TOOLCHAIN_UNKNOWN_TOOL: (p) =>
    `service ${quoted(p.service)} names ${quoted(p.tool)}, which is not in the catalog`,
  TOOLCHAIN_UNKNOWN_SERVICE: (p) =>
    `job ${quoted(p.job)} is integrated with ${quoted(p.service)}, which is not a declared service`,
  TOOLCHAIN_UNKNOWN_JOB: (p) => `toolchain.yaml names job ${quoted(p.job)}, which does not exist`,
  TOOLCHAIN_JOB_TOOL_AS_SERVICE: (p) =>
    `service ${quoted(p.service)} names ${quoted(p.tool)}, a tool that runs as a CI job: its layers count as covered by this declaration alone`,
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
    // This path is reached only after establishing that the need *is* in the effective value, but
    // that the local list is not a sequence readable item by item — an anchor alias or a
    // `!reference`. Saying "does not need" here would state the opposite of what led here.
    notLocal: (p) =>
      `job ${quoted(p.job)} needs ${quoted(p.need)} through an anchor or a !reference, so removing it would mean rewriting that shared list`,
  },
  CYCLE: (p) => `operation ${p.operation} would create a cycle in needs`,
  UNSUPPORTED_VERSION: (p) =>
    `operation version ${p.received} is not supported, expected ${p.supported}`,
  INVALID_OPERATION: {
    notAnObject: () => "an operation must be a JSON object",
    // `detail` comes from zod, in English. `path` locates it in the received operation.
    schema: (p) => (p.path === "" ? p.detail : `${p.path}: ${p.detail}`),
    flowStyleJob: (p) =>
      `job ${quoted(p.job)} sits in a top-level map written in flow style, in-place editing is not supported`,
    jobWithoutScript: () => "an added job must have at least one script line",
    sharedValue: (p) =>
      `the ${p.key} of ${quoted(p.job)} comes through an anchor or a !reference that Keelson cannot rewrite in place`,
    flowStyleToolchain: (p) =>
      `the ${p.section} section is written in flow style, in-place editing is not supported`,
    invalidToolchain: () => "toolchain.yaml is not usable, fix it before editing it here",
    invalidSnippet: () => "this snippet is not a single job Keelson can copy as it is",
    citedInExpression: (p) =>
      `job ${quoted(p.job)} is cited in an expression that Keelson cannot rewrite, so this change would break it`,
    dynamicExpression: (p) =>
      `an expression reads needs or jobs as a whole or by a computed index, so it may reach ${quoted(p.job)}: Keelson refuses rather than break it`,
    readsOwnId: (p) =>
      `job ${quoted(p.job)} compares its own id at run time (github.job or GITHUB_JOB) with its name: renaming it would change what it does`,
    notForProvider: (p) => `operation ${p.operation} has no meaning in a GitHub Actions workflow`,
    invalidLayout: () => "layout.json is not usable, fix it before moving nodes",
    outsideRoot: (p) => `${quoted(p.path)} leads outside the repository, nothing was written`,
    notADirectory: (p) => `${quoted(p.path)} is not a directory, nothing was written`,
    noRootMap: () => "this file has no YAML map at its root",
    notUtf8: (p) => `${quoted(p.file)} is not UTF-8 text, Keelson does not rewrite it`,
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
