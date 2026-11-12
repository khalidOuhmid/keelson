import { detectIntegrations, type Tool } from "@keelson/catalog";
import type { Diagnostic, IntegrationKind, Pipeline, Toolchain } from "@keelson/core";
import {
  INVALID_YAML,
  isPartial,
  TOOLCHAIN_DUPLICATE_INTEGRATION,
  TOOLCHAIN_FILE,
  TOOLCHAIN_JOB_TOOL_AS_SERVICE,
  TOOLCHAIN_UNKNOWN_JOB,
  TOOLCHAIN_UNKNOWN_SERVICE,
  TOOLCHAIN_UNKNOWN_TOOL,
} from "@keelson/core";
import { parseToolchain } from "./parse.ts";

/** `services`: the declared services of this tool, to which the proposal can be confirmed. */
export type ProposedIntegration = {
  job: string;
  tool: string;
  kind: IntegrationKind;
  services: string[];
};

/** Inference proposes, the file decides (ADR 0010): nothing that comes out of here is written. */
export function proposeIntegrations(
  pipeline: Pipeline,
  toolchain: Toolchain,
  tools: readonly Tool[],
): ProposedIntegration[] {
  const proposed = pipeline.jobs.flatMap((job) =>
    detectIntegrations(job.signals, tools).flatMap(({ tool, kind }): ProposedIntegration[] => {
      const services = toolchain.services
        .filter((service) => service.tool === tool)
        .map((service) => service.id);
      const settled =
        toolchain.integrations.some(
          (entry) =>
            entry.job === job.id && entry.kind === kind && services.includes(entry.service),
        ) ||
        toolchain.dismissed.some(
          (entry) => entry.job === job.id && entry.tool === tool && entry.kind === kind,
        );
      return settled ? [] : [{ job: job.id, tool, kind, services }];
    }),
  );
  // Two workflows can carry a job with the same name: the decision to make is the same.
  const keys = proposed.map((entry) => JSON.stringify([entry.job, entry.tool, entry.kind]));
  return proposed.filter((_, index) => keys.indexOf(keys[index] as string) === index);
}

function diagnostic(found: Omit<Diagnostic, "range" | "file">): Diagnostic {
  return { ...found, range: null, file: TOOLCHAIN_FILE } as Diagnostic;
}

export function validateToolchain(
  toolchain: Toolchain,
  pipeline: Pipeline,
  tools: readonly Tool[],
): Diagnostic[] {
  const unknownTools = toolchain.services
    .filter((service) => !tools.some((tool) => tool.id === service.tool))
    .map((service) =>
      diagnostic({
        code: TOOLCHAIN_UNKNOWN_TOOL,
        severity: "error",
        params: { service: service.id, tool: service.tool },
      }),
    );

  const jobTools = toolchain.services
    .filter((service) => tools.some((tool) => tool.id === service.tool && tool.kind === "job"))
    .map((service) =>
      diagnostic({
        code: TOOLCHAIN_JOB_TOOL_AS_SERVICE,
        severity: "warning",
        params: { service: service.id, tool: service.tool },
      }),
    );

  const seen = new Set<string>();
  const reported = new Set<string>();
  const integrations = toolchain.integrations.flatMap((entry): Diagnostic[] => {
    const key = JSON.stringify([entry.job, entry.service, entry.kind]);
    const repeated = seen.has(key);
    seen.add(key);
    if (repeated) {
      if (reported.has(key)) {
        return [];
      }
      reported.add(key);
      return [
        diagnostic({
          code: TOOLCHAIN_DUPLICATE_INTEGRATION,
          severity: "warning",
          params: { job: entry.job, service: entry.service, kind: entry.kind },
        }),
      ];
    }

    return [
      ...(toolchain.services.some((service) => service.id === entry.service)
        ? []
        : [
            diagnostic({
              code: TOOLCHAIN_UNKNOWN_SERVICE,
              severity: "error",
              params: { job: entry.job, service: entry.service },
            }),
          ]),
      ...(pipeline.jobs.some((job) => job.id === entry.job)
        ? []
        : [
            diagnostic({
              code: TOOLCHAIN_UNKNOWN_JOB,
              severity: isPartial(pipeline) ? "warning" : "error",
              params: { job: entry.job },
            }),
          ]),
    ];
  });

  return [...unknownTools, ...jobTools, ...integrations];
}

export type ToolchainAnalysis = {
  toolchain: Toolchain;
  diagnostics: Diagnostic[];
  proposed: ProposedIntegration[];
};

/** What the API and `keelson validate` say about the toolchain: both must say the same thing.
 *  `parsing` are the diagnostics of the CI files: one that did not parse leaves its jobs out, as an
 *  unresolved include does, so a job the toolchain names may be one of them. */
export function analyseToolchain(
  text: string | null,
  pipeline: Pipeline,
  tools: readonly Tool[],
  parsing: readonly Diagnostic[] = [],
): ToolchainAnalysis {
  const { toolchain, diagnostics } = parseToolchain(text);
  const truncated = parsing.some((entry) => entry.code === INVALID_YAML);
  const validated = validateToolchain(toolchain, pipeline, tools).map((entry) =>
    truncated && entry.code === TOOLCHAIN_UNKNOWN_JOB
      ? { ...entry, severity: "warning" as const }
      : entry,
  );
  return {
    toolchain,
    diagnostics: [...diagnostics, ...validated],
    proposed: proposeIntegrations(pipeline, toolchain, tools),
  };
}
