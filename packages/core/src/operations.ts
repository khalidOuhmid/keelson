import { z } from "zod";
import { err, ok, type Result } from "./result.ts";

export const OPERATION_VERSION = 1;

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

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];

export type OperationError = {
  code: OperationErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export const RESERVED_JOB_NAMES = [
  "stages",
  "variables",
  "include",
  "default",
  "workflow",
  "image",
  "services",
  "cache",
  "before_script",
  "after_script",
] as const;

export function isLegalJobName(name: string): boolean {
  return name !== "" && !name.startsWith(".") && !RESERVED_JOB_NAMES.includes(name as never);
}

const base = {
  v: z.literal(OPERATION_VERSION),
  baseHash: z.string().regex(/^[0-9a-f]{64}$/),
};

const offset = z.number().int().min(0);

const needInput = z
  .object({
    job: z.string(),
    optional: z.boolean().optional(),
    artifacts: z.boolean().optional(),
  })
  .strict();

const environmentInput = z
  .object({
    name: z.string(),
    url: z.string().optional(),
    action: z.string().optional(),
  })
  .strict();

export const addJobSchema = z
  .object({
    ...base,
    kind: z.literal("addJob"),
    job: z
      .object({
        id: z.string(),
        stage: z.string(),
        needs: z.array(needInput).optional(),
        environment: environmentInput.optional(),
        script: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export const removeJobSchema = z
  .object({ ...base, kind: z.literal("removeJob"), id: z.string() })
  .strict();

export const renameJobSchema = z
  .object({ ...base, kind: z.literal("renameJob"), from: z.string(), to: z.string() })
  .strict();

export const setJobStageSchema = z
  .object({ ...base, kind: z.literal("setJobStage"), id: z.string(), stage: z.string() })
  .strict();

export const addNeedSchema = z
  .object({ ...base, kind: z.literal("addNeed"), id: z.string(), need: needInput })
  .strict();

export const removeNeedSchema = z
  .object({ ...base, kind: z.literal("removeNeed"), id: z.string(), job: z.string() })
  .strict();

export const setEnvironmentSchema = z
  .object({
    ...base,
    kind: z.literal("setEnvironment"),
    id: z.string(),
    environment: z.union([environmentInput, z.null()]),
  })
  .strict();

export const addStageSchema = z
  .object({
    ...base,
    kind: z.literal("addStage"),
    name: z.string(),
    index: offset.optional(),
  })
  .strict();

export const moveStageSchema = z
  .object({ ...base, kind: z.literal("moveStage"), name: z.string(), toIndex: offset })
  .strict();

export const spliceSchema = z
  .object({
    ...base,
    kind: z.literal("splice"),
    start: offset,
    end: offset,
    text: z.string(),
  })
  .strict();

export const operationSchema = z.discriminatedUnion("kind", [
  addJobSchema,
  removeJobSchema,
  renameJobSchema,
  setJobStageSchema,
  addNeedSchema,
  removeNeedSchema,
  setEnvironmentSchema,
  addStageSchema,
  moveStageSchema,
  spliceSchema,
]);

export type AddJobOperation = z.infer<typeof addJobSchema>;
export type RemoveJobOperation = z.infer<typeof removeJobSchema>;
export type RenameJobOperation = z.infer<typeof renameJobSchema>;
export type SetJobStageOperation = z.infer<typeof setJobStageSchema>;
export type AddNeedOperation = z.infer<typeof addNeedSchema>;
export type RemoveNeedOperation = z.infer<typeof removeNeedSchema>;
export type SetEnvironmentOperation = z.infer<typeof setEnvironmentSchema>;
export type AddStageOperation = z.infer<typeof addStageSchema>;
export type MoveStageOperation = z.infer<typeof moveStageSchema>;
export type SpliceOperation = z.infer<typeof spliceSchema>;
export type Operation = z.infer<typeof operationSchema>;

export function parseOperation(input: unknown): Result<Operation, OperationError> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err({
      code: INVALID_OPERATION,
      message: "une opération doit être un objet JSON",
    });
  }

  const version = (input as { v?: unknown }).v;
  if (typeof version === "number" && version !== OPERATION_VERSION) {
    return err({
      code: UNSUPPORTED_VERSION,
      message: `version d'opération ${version} non supportée, attendu ${OPERATION_VERSION}`,
      details: { received: version, supported: OPERATION_VERSION },
    });
  }

  const parsed = operationSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue === undefined ? "" : issue.path.join(".");
    const detail = issue === undefined ? "forme invalide" : issue.message;
    return err({
      code: INVALID_OPERATION,
      message: path === "" ? detail : `${path} : ${detail}`,
      details: { issues: parsed.error.issues },
    });
  }

  return ok(parsed.data);
}
