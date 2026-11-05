import { detectIntegrations, type Tool } from "@keelson/catalog";
import type { Diagnostic, IntegrationKind, Pipeline, Toolchain } from "@keelson/core";
import {
  isPartial,
  TOOLCHAIN_DUPLICATE_INTEGRATION,
  TOOLCHAIN_FILE,
  TOOLCHAIN_UNKNOWN_JOB,
  TOOLCHAIN_UNKNOWN_SERVICE,
  TOOLCHAIN_UNKNOWN_TOOL,
} from "@keelson/core";
import { parseToolchain } from "./parse.ts";

/** `services` : les services déclarés de cet outil, vers lesquels la proposition peut se confirmer. */
export type ProposedIntegration = {
  job: string;
  tool: string;
  kind: IntegrationKind;
  services: string[];
};

/** L'inférence propose, le fichier décide (ADR 0010) : rien de ce qui sort d'ici n'est écrit. */
export function proposeIntegrations(
  pipeline: Pipeline,
  toolchain: Toolchain,
  tools: readonly Tool[],
): ProposedIntegration[] {
  return pipeline.jobs.flatMap((job) =>
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

  return [...unknownTools, ...integrations];
}

export type ToolchainAnalysis = {
  toolchain: Toolchain;
  diagnostics: Diagnostic[];
  proposed: ProposedIntegration[];
};

/** Ce que l'API et `keelson validate` disent de la toolchain : les deux doivent dire la même chose. */
export function analyseToolchain(
  text: string | null,
  pipeline: Pipeline,
  tools: readonly Tool[],
): ToolchainAnalysis {
  const { toolchain, diagnostics } = parseToolchain(text);
  return {
    toolchain,
    diagnostics: [...diagnostics, ...validateToolchain(toolchain, pipeline, tools)],
    proposed: proposeIntegrations(pipeline, toolchain, tools),
  };
}
