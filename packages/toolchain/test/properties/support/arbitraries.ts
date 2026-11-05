import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INTEGRATION_KINDS,
  type OperationError,
  type Toolchain,
  type ToolchainOperation,
} from "@keelson/core";
import fc from "fast-check";
import { parseToolchain } from "../../../src/index.ts";

export function assertOptions(): fc.Parameters<unknown> {
  const seed = process.env.KEELSON_FC_SEED;
  return {
    numRuns: Number(process.env.KEELSON_FC_RUNS ?? 25),
    ...(seed === undefined ? {} : { seed: Number(seed) }),
  };
}

const CORPUS = join(import.meta.dir, "..", "..", "corpus");

export function corpusTexts(): string[] {
  return readdirSync(CORPUS)
    .sort()
    .map((name) => readFileSync(join(CORPUS, name), "utf8"));
}

export type Draft = ToolchainOperation extends infer O
  ? O extends ToolchainOperation
    ? Omit<O, "v" | "baseHash">
    : never
  : never;

const word = fc.constantFrom("build", "deploy", "scan", "a b", "x: y", "#z", "ÿ", "'q'");
const id = fc.constantFrom("nexus", "harbor.prod", "vault", "new-one", "z_9");
const value = fc.constantFrom("https://a.example", "prod", "a: b", "# c", "é", "x\ny", "[z");
const optional = fc.option(value, { nil: null });
const kind = fc.constantFrom(...INTEGRATION_KINDS);

/** Mêle des cibles qui existent et d'autres non : les refus sont aussi une partie du contrat. */
export function operationArb(text: string): fc.Arbitrary<Draft> {
  const { toolchain } = parseToolchain(text);
  const ids = [...toolchain.services.map((service) => service.id), "new-one"];
  const known = fc.constantFrom(...ids);
  const linked = toolchain.integrations.length
    ? fc.constantFrom(...toolchain.integrations)
    : fc.constant({ job: "build", service: "vault", kind: "push" as const });
  const ignored = toolchain.dismissed.length
    ? fc.constantFrom(...toolchain.dismissed)
    : fc.constant({ job: "scan", tool: "sentry", kind: "notify" as const });

  return fc.oneof(
    fc.record({
      kind: fc.constant("addService" as const),
      id,
      tool: word,
      url: optional,
      environment: optional,
    }),
    fc.record(
      {
        kind: fc.constant("updateService" as const),
        id: known,
        tool: word,
        url: optional,
        environment: optional,
      },
      { requiredKeys: ["kind", "id"] },
    ),
    fc.record({ kind: fc.constant("removeService" as const), id: known }),
    fc.record({
      kind: fc.constant("addIntegration" as const),
      job: word,
      service: known,
      integration: kind,
    }),
    linked.map(({ job, service, kind: integration }) => ({
      kind: "removeIntegration" as const,
      job,
      service,
      integration,
    })),
    fc.record({
      kind: fc.constant("dismissIntegration" as const),
      job: word,
      tool: word,
      integration: kind,
    }),
    ignored.map(({ job, tool, kind: integration }) => ({
      kind: "restoreIntegration" as const,
      job,
      tool,
      integration,
    })),
  ) as fc.Arbitrary<Draft>;
}

/** Les refus qui sont une réponse, pas une panne : sur le corpus, tout autre refus est un défaut. */
const EXPECTED_REFUSALS: readonly string[] = [
  "NAME_CONFLICT",
  "INVALID_NAME",
  "SERVICE_NOT_FOUND",
  "SERVICE_REFERENCED",
  "INTEGRATION_EXISTS",
  "INTEGRATION_NOT_FOUND",
];

const SHARED_CORPUS_REASONS: readonly string[] = ["sharedValue", "flowStyleToolchain"];

export function isExpectedRefusal(error: OperationError): boolean {
  if (EXPECTED_REFUSALS.includes(error.code)) {
    return true;
  }
  return (
    error.code === "INVALID_OPERATION" &&
    "reason" in error.params &&
    SHARED_CORPUS_REASONS.includes(error.params.reason)
  );
}

/** Ce que l'opération doit produire sur le modèle, écrit sans passer par le texte. */
export function expected(model: Toolchain, draft: Draft): Toolchain {
  switch (draft.kind) {
    case "addService":
      return {
        ...model,
        services: [
          ...model.services,
          {
            id: draft.id,
            tool: draft.tool,
            url: draft.url,
            environment: draft.environment,
          },
        ],
      };
    case "updateService":
      return {
        ...model,
        services: model.services.map((service) =>
          service.id === draft.id
            ? {
                ...service,
                tool: draft.tool ?? service.tool,
                url: draft.url === undefined ? service.url : draft.url,
                environment:
                  draft.environment === undefined ? service.environment : draft.environment,
              }
            : service,
        ),
      };
    case "removeService":
      return { ...model, services: model.services.filter((service) => service.id !== draft.id) };
    case "addIntegration":
      return {
        ...model,
        integrations: [
          ...model.integrations,
          { job: draft.job, service: draft.service, kind: draft.integration },
        ],
      };
    case "removeIntegration": {
      const position = model.integrations.findIndex(
        (entry) =>
          entry.job === draft.job &&
          entry.service === draft.service &&
          entry.kind === draft.integration,
      );
      return { ...model, integrations: model.integrations.toSpliced(position, 1) };
    }
    case "dismissIntegration":
      return {
        ...model,
        dismissed: [
          ...model.dismissed,
          { job: draft.job, tool: draft.tool, kind: draft.integration },
        ],
      };
    case "restoreIntegration": {
      const position = model.dismissed.findIndex(
        (entry) =>
          entry.job === draft.job && entry.tool === draft.tool && entry.kind === draft.integration,
      );
      return { ...model, dismissed: model.dismissed.toSpliced(position, 1) };
    }
    case "splice":
      return model;
  }
}
