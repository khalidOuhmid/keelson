import type { Diagnostic, Pipeline } from "@keelson/core";
import { INVALID_YAML, isPartial } from "@keelson/core";
import { LAYERS, type LayerId } from "@keelson/taxonomy";
import { detectTools } from "./detect.ts";
import type { Tool } from "./schema.ts";

/** Une entrée remplace la détection du job, une liste vide la neutralise. */
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
};

/** `partial` : ce qui manque à un pipeline partiel peut couvrir une couche. Une couche absente ici
 *  n'est donc pas une couche absente du dépôt, et la couverture est une borne basse. */
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
): Coverage {
  const jobs = pipeline.jobs.map((job) => jobCoverage(job.id, job.signals, tools, overrides));
  return {
    jobs,
    layers: LAYERS.map(({ id }) => {
      const covering = jobs.filter((job) => job.layers.includes(id)).map((job) => job.job);
      return { layer: id, covered: covering.length > 0, jobs: covering };
    }),
    // Un fichier illisible rend un pipeline tronqué : ses couches manquantes ne prouvent rien.
    partial: isPartial(pipeline) || parsing.some((entry) => entry.code === INVALID_YAML),
  };
}
