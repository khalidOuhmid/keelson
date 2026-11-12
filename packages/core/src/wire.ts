import { z } from "zod";
import type { Diagnostic } from "./diagnostics.ts";
import type { Pipeline } from "./ir.ts";
import { DIAGNOSTIC_CODES, type MessageCode, type MessageParams } from "./messages/codes.ts";

/** What crosses the network into a client that cannot trust it: a payload the types promise and
 *  the wire does not guarantee. A shape refused here becomes `UNEXPECTED_RESPONSE`, never a crash
 *  nor a sentence that reads "undefined". */

const text = z.string();
const count = z.number().int().nonnegative();
const names = z.array(text).readonly();

const reasons = <const T extends readonly [z.ZodObject, ...z.ZodObject[]]>(...branches: T) =>
  z.discriminatedUnion("reason", branches);

const reason = <const R extends string, S extends z.ZodRawShape>(name: R, shape: S) =>
  z.object({ reason: z.literal(name), ...shape });

const INCLUDE_FORMS = ["local", "remote", "project", "template", "component", "workflow"] as const;

export const PARAMS_SCHEMAS = {
  INVALID_YAML: z.object({ detail: text }),
  INCLUDE_UNRESOLVED: z.object({ form: z.enum(INCLUDE_FORMS), detail: text }),
  WORKFLOW_UNRESOLVED: z.object({ job: text, target: text }),
  WORKFLOW_CALL_INVALID: reasons(
    reason("missing", { job: text, path: text }),
    reason("outsideRoot", { job: text, path: text }),
    reason("notInWorkflows", { job: text, path: text }),
    reason("cycle", { job: text, trail: z.array(text) }),
    reason("depth", { job: text, path: text, limit: count }),
    reason("limit", { job: text, path: text, limit: count }),
  ),
  INCLUDE_NOT_FOUND: reasons(
    reason("missing", { path: text }),
    reason("notYaml", { path: text }),
    reason("outsideRoot", { path: text }),
    reason("malformed", {}),
  ),
  INCLUDE_CYCLE: z.object({ trail: names }),
  INCLUDE_LIMIT_EXCEEDED: z.object({ limit: count }),
  EXTENDS_TARGET_NOT_FOUND: z.object({ template: text }),
  EXTENDS_CYCLE: z.object({ trail: names }),
  EXTENDS_DEPTH_EXCEEDED: z.object({ job: text, limit: count }),
  VALUE_CYCLE: z.object({ job: text, key: text }),
  JOB_WITHOUT_SCRIPT: z.object({ job: text }),
  UNKNOWN_NEED: z.object({ job: text, need: text }),
  NEEDS_CYCLE: z.object({ cycle: names }),
  UNKNOWN_STAGE: z.object({ job: text, stage: text }),
  NEED_LATER_STAGE: z.object({ job: text, stage: text, need: text, needStage: text }),
  LAYOUT_INVALID: z.object({ detail: text }),
  LAYOUT_UNKNOWN_LAYER: z.object({ job: text, layer: text }),
  LAYOUT_UNKNOWN_JOB: z.object({ job: text }),
  COVERAGE_LAYER_MISSING: z.object({ layer: text, name: text }),
  CATALOG_INVALID_TOOL: z.object({ detail: text }),
  CATALOG_DUPLICATE_TOOL: z.object({ tool: text }),
  CATALOG_UNKNOWN_LOGO: z.object({ tool: text, logo: text }),
  CATALOG_MISSING_SNIPPET: z.object({ tool: text }),
  CATALOG_STALE_TOOL: z.object({ tool: text, lastVerified: text }),
  CATALOG_FUTURE_VERIFIED: z.object({ tool: text, lastVerified: text }),
  TOOLCHAIN_INVALID: z.object({ detail: text }),
  TOOLCHAIN_UNKNOWN_TOOL: z.object({ service: text, tool: text }),
  TOOLCHAIN_UNKNOWN_SERVICE: z.object({ job: text, service: text }),
  TOOLCHAIN_UNKNOWN_JOB: z.object({ job: text }),
  TOOLCHAIN_DUPLICATE_INTEGRATION: z.object({ job: text, service: text, kind: text }),
  TOOLCHAIN_JOB_TOOL_AS_SERVICE: z.object({ service: text, tool: text }),

  STALE_DOCUMENT: z.object({ expected: text, received: text }),
  JOB_NOT_FOUND: z.object({ job: text }),
  JOB_REFERENCED: z.object({ job: text, referencedBy: names }),
  NAME_CONFLICT: z.object({ name: text }),
  INVALID_NAME: reasons(
    reason("job", { name: text }),
    reason("stage", {}),
    reason("service", { name: text }),
  ),
  STAGE_NOT_FOUND: z.object({ stage: text }),
  STAGE_EXISTS: z.object({ stage: text }),
  NEED_EXISTS: z.object({ job: text, need: text }),
  NEED_NOT_FOUND: reasons(
    reason("notNeeded", { job: text, need: text }),
    reason("notLocal", { job: text, need: text }),
  ),
  CYCLE: z.object({ operation: text }),
  UNSUPPORTED_VERSION: z.object({ received: z.number(), supported: z.number() }),
  INVALID_OPERATION: reasons(
    reason("notAnObject", {}),
    reason("schema", { path: text, detail: text }),
    reason("flowStyleJob", { job: text }),
    reason("jobWithoutScript", {}),
    reason("sharedValue", { job: text, key: text }),
    reason("flowStyleToolchain", { section: text }),
    reason("invalidToolchain", {}),
    reason("invalidLayout", {}),
    reason("invalidSnippet", {}),
    reason("notForProvider", { operation: text }),
    reason("citedInExpression", { job: text }),
    reason("dynamicExpression", { job: text }),
    reason("readsOwnId", { job: text }),
    reason("outsideRoot", { path: text }),
    reason("noRootMap", {}),
    reason("notUtf8", { file: text }),
    reason("wouldBreakYaml", { operation: text }),
    reason("unreadableBody", {}),
    reason("missingOpId", {}),
    reason("missingOp", {}),
  ),
  RANGE_OUT_OF_BOUNDS: reasons(
    reason("jobRange", { job: text }),
    reason("stageKey", {}),
    reason("needsKey", {}),
    reason("lastNeed", {}),
    reason("environmentKey", {}),
    reason("stageList", {}),
    reason("emptyStageList", {}),
    reason("stageIndex", { index: z.number(), count: z.number() }),
    reason("textRange", { start: z.number(), end: z.number(), length: z.number() }),
  ),
  FROM_INCLUDED_FILE: reasons(
    reason("job", { job: text, file: text }),
    reason("stages", { file: text }),
    reason("nameTaken", { name: text, file: text }),
    reason("referencedByInclude", {
      job: text,
      referencedBy: z.array(z.object({ job: text, file: text })).readonly(),
    }),
  ),

  SERVICE_NOT_FOUND: z.object({ service: text }),
  SERVICE_REFERENCED: z.object({ service: text, jobs: names }),
  INTEGRATION_EXISTS: z.object({ job: text, target: text, kind: text }),
  INTEGRATION_NOT_FOUND: z.object({ job: text, target: text, kind: text }),

  FORBIDDEN_HOST: z.object({}),
  FORBIDDEN_TOKEN: z.object({}),
  METHOD_NOT_ALLOWED: z.object({ method: text }),
  NOT_FOUND: reasons(
    reason("unreadableFileName", {}),
    reason("unknownFile", { file: text }),
    reason("missingFile", { file: text }),
    reason("unknownRoute", { route: text }),
    reason("noUiBundle", {}),
  ),
  PAYLOAD_TOO_LARGE: z.object({ limitBytes: z.number() }),
  INTERNAL_ERROR: z.object({}),

  NETWORK_ERROR: z.object({ detail: text }),
  UNEXPECTED_RESPONSE: z.object({}),
} satisfies { [C in MessageCode]: z.ZodType };

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Drifted = {
  [C in MessageCode]: Same<z.output<(typeof PARAMS_SCHEMAS)[C]>, MessageParams[C]> extends true
    ? never
    : C;
}[MessageCode];

/** A schema that drifts from `MessageParams` must not compile: the error names the code. */
export const PARAMS_SCHEMAS_MATCH_THE_REGISTRY: [Drifted] extends [never] ? true : Drifted = true;

export function paramsFit(code: MessageCode, params: unknown): boolean {
  return PARAMS_SCHEMAS[code].safeParse(params).success;
}

const sourceRange = z.object({ start: z.number(), end: z.number() });

const origin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }),
  z.object({ kind: z.literal("default") }),
  z.object({ kind: z.literal("extends"), template: text }),
  z.object({ kind: z.literal("anchor"), name: text }),
  z.object({ kind: z.literal("reference"), path: z.array(text) }),
  z.object({ kind: z.literal("include"), file: text }),
]);

const valued = <T extends z.ZodType>(value: T) => z.object({ value, origin });

const opaqueBlock = z.object({ key: text, range: sourceRange, file: text });

const job = z.object({
  id: text,
  stage: valued(text),
  needs: valued(
    z.array(z.object({ job: text, optional: z.boolean(), artifacts: z.boolean() })),
  ).nullable(),
  unmodelledNeeds: z.literal(true).exactOptional(),
  environment: valued(
    z.object({ name: text, url: text.exactOptional(), action: text.exactOptional() }),
  ).nullable(),
  extends: z.array(text),
  opaque: z.array(opaqueBlock),
  signals: z.object({
    image: text.nullable(),
    script: z.array(text),
    actions: z.array(text).exactOptional(),
  }),
  range: sourceRange,
  file: text,
});

export const pipelineSchema = z.object({
  stages: z.array(
    z.object({ name: text, implicit: z.boolean(), range: sourceRange.nullable(), file: text }),
  ),
  jobs: z.array(job),
  templates: z.array(z.object({ id: text, range: sourceRange, file: text })),
  opaque: z.array(opaqueBlock),
  main: text,
  files: z.array(text),
  unresolved: z.array(
    z.object({
      form: z.enum(INCLUDE_FORMS),
      detail: text,
      from: text,
      range: sourceRange.nullable(),
    }),
  ),
  provider: z.literal("github").exactOptional(),
});

/** The schema and the IR are the same type: a field the IR gains or changes breaks the build. */
export const PIPELINE_SCHEMA_MATCHES_THE_IR: Same<z.output<typeof pipelineSchema>, Pipeline> = true;

export const diagnosticSchema = z
  .object({
    code: z.enum(DIAGNOSTIC_CODES),
    severity: z.enum(["error", "warning", "info"]),
    params: z.unknown(),
    range: sourceRange.nullable(),
    file: text,
  })
  .refine((entry) => paramsFit(entry.code, entry.params), { path: ["params"] })
  .transform((entry) => entry as Diagnostic);

export const sourceRangeSchema = sourceRange;
