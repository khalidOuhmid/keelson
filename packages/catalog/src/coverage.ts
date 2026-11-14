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
  /** The CI systems whose jobs prove this layer: only a forge runs its own CI, so a job proves
   *  source control. Empty on every other layer. */
  ci: readonly CiSystem[];
};

export type CiSystem = "gitlab-ci" | "github-actions";

const PROVEN_BY_CI: LayerId = "scm";

const WORKFLOWS_DIR = ".github/workflows";

/** By the job's file, as the server picks the adapter: a workflow is a file of `.github/workflows`. */
function ciOf(file: string): CiSystem {
  const directory = file.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
  return directory === WORKFLOWS_DIR || directory.endsWith(`/${WORKFLOWS_DIR}`)
    ? "github-actions"
    : "gitlab-ci";
}

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
  const systems = [...new Set(pipeline.jobs.map((job) => ciOf(job.file)))];
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
      const ci = id === PROVEN_BY_CI ? systems : [];
      return {
        layer: id,
        covered: covering.length > 0 || declared.length > 0 || ci.length > 0,
        jobs: covering,
        services: declared,
        ci,
      };
    }),
    // An unreadable file yields a truncated pipeline: its missing layers prove nothing.
    partial: isPartial(pipeline) || parsing.some((entry) => entry.code === INVALID_YAML),
  };
}

export type LowerBoundCause = "invalidYaml" | "unresolvedInclude" | "unresolvedWorkflow";

/** Unreadable YAML first: it hides more than an include does, and it is what the user must fix. */
export function lowerBoundCause(
  pipeline: Pipeline,
  parsing: readonly Diagnostic[],
): LowerBoundCause | null {
  if (parsing.some((entry) => entry.code === INVALID_YAML)) {
    return "invalidYaml";
  }
  if (pipeline.unresolved.length === 0) {
    return null;
  }
  return pipeline.unresolved.every((entry) => entry.form === "workflow")
    ? "unresolvedWorkflow"
    : "unresolvedInclude";
}

const LOWER_BOUND: Record<LowerBoundCause, string> = {
  invalidYaml:
    "part of the pipeline is not valid YAML, so a layer listed as uncovered may be covered by what Keelson cannot read",
  unresolvedInclude:
    "an include could not be resolved, so a layer listed as uncovered may be covered by the jobs it holds",
  unresolvedWorkflow:
    "a called workflow could not be read, so a layer listed as uncovered may be covered by its jobs",
};

/** The one wording of the lower bound, for the CLI and the UI alike. */
export function lowerBoundNote(cause: LowerBoundCause): string {
  return `Coverage is a lower bound: ${LOWER_BOUND[cause]}.`;
}
