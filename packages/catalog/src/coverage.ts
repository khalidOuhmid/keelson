import type { Diagnostic, Pipeline, Service } from "@keelson/core";
import { INVALID_YAML, isPartial } from "@keelson/core";
import { LAYERS, type LayerId } from "@keelson/taxonomy";
import { detectTools } from "./detect.ts";
import type { Tool } from "./schema.ts";

/** An entry replaces the job's detection; an empty list disables it. */
export type LayerOverrides = Readonly<Record<string, readonly LayerId[]>>;

export type JobCoverage = {
  job: string;
  layers: readonly LayerId[];
  tools: readonly string[];
  overridden: boolean;
};

export type LayerCoverage = {
  layer: LayerId;
  covered: boolean;
  jobs: readonly string[];
  /** The declared services whose tool carries this layer (ADR 0011). */
  services: readonly string[];
};

/** `partial`: what a partial pipeline is missing may cover a layer. A layer absent here is
 *  therefore not a layer absent from the repository, and coverage is a lower bound. */
export type Coverage = {
  jobs: readonly JobCoverage[];
  layers: readonly LayerCoverage[];
  partial: boolean;
};

function jobCoverage(
  id: string,
  signals: Pipeline["jobs"][number]["signals"],
  tools: readonly Tool[],
  overrides: LayerOverrides,
): JobCoverage {
  const detected = detectTools(signals, tools);
  const override = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
  const layers = override ?? detected.flatMap((entry) => entry.layers);
  return {
    job: id,
    layers: LAYERS.map((layer) => layer.id).filter((layer) => layers.includes(layer)),
    tools: detected.map((entry) => entry.tool),
    overridden: override !== undefined,
  };
}

export function coverage(
  pipeline: Pipeline,
  tools: readonly Tool[],
  overrides: LayerOverrides = {},
  parsing: readonly Diagnostic[] = [],
  services: readonly Service[] = [],
): Coverage {
  const jobs = pipeline.jobs.map((job) => jobCoverage(job.id, job.signals, tools, overrides));
  return {
    jobs,
    layers: LAYERS.map(({ id }) => {
      // Two workflows can carry a job with the same name: it is named only once.
      const covering = [
        ...new Set(jobs.filter((job) => job.layers.includes(id)).map((job) => job.job)),
      ];
      const declared = services
        .filter((service) =>
          tools.some((tool) => tool.id === service.tool && tool.layers.includes(id)),
        )
        .map((service) => service.id);
      return {
        layer: id,
        covered: covering.length > 0 || declared.length > 0,
        jobs: covering,
        services: declared,
      };
    }),
    // An unreadable file yields a truncated pipeline: its missing layers prove nothing.
    partial: isPartial(pipeline) || parsing.some((entry) => entry.code === INVALID_YAML),
  };
}
