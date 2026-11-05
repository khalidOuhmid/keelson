import { z } from "zod";
import { type OperationError, spliceSchema, validatedOperation } from "./operations.ts";
import type { Result } from "./result.ts";

export const TOOLCHAIN_FILE = ".devsecops/toolchain.yaml";

export const INTEGRATION_KINDS = ["push", "upload-report", "fetch-secret", "notify"] as const;

export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** Une instance nommée : deux Nexus sur deux environnements sont deux services. */
export type Service = {
  id: string;
  tool: string;
  url: string | null;
  environment: string | null;
};

export type Integration = { job: string; service: string; kind: IntegrationKind };

/** Une inférence que l'utilisateur a écartée : sans cela, un faux positif reviendrait à chaque
 *  analyse. */
export type DismissedIntegration = { job: string; tool: string; kind: IntegrationKind };

export type Toolchain = {
  services: Service[];
  integrations: Integration[];
  dismissed: DismissedIntegration[];
};

export function emptyToolchain(): Toolchain {
  return { services: [], integrations: [], dismissed: [] };
}

const SERVICE_ID = /^[a-z0-9][a-z0-9._-]*$/;

export function isLegalServiceId(id: string): boolean {
  return SERVICE_ID.test(id);
}

const base = {
  v: z.literal(1),
  baseHash: z.string().regex(/^[0-9a-f]{64}$/),
};
const text = z.string().min(1);
const kind = z.enum(INTEGRATION_KINDS);

const schemas = [
  z.strictObject({
    ...base,
    kind: z.literal("addService"),
    id: z.string(),
    tool: text,
    url: text.nullable(),
    environment: text.nullable(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("updateService"),
    id: z.string(),
    tool: text.optional(),
    url: text.nullable().optional(),
    environment: text.nullable().optional(),
  }),
  z.strictObject({ ...base, kind: z.literal("removeService"), id: z.string() }),
  z.strictObject({
    ...base,
    kind: z.literal("addIntegration"),
    job: text,
    service: text,
    integration: kind,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("removeIntegration"),
    job: text,
    service: text,
    integration: kind,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("dismissIntegration"),
    job: text,
    tool: text,
    integration: kind,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("restoreIntegration"),
    job: text,
    tool: text,
    integration: kind,
  }),
  spliceSchema,
] as const;

export const toolchainOperationSchema = z.discriminatedUnion("kind", [...schemas]);

export type ToolchainOperation = z.infer<typeof toolchainOperationSchema>;

export function parseToolchainOperation(
  input: unknown,
): Result<ToolchainOperation, OperationError> {
  return validatedOperation(input, toolchainOperationSchema);
}
