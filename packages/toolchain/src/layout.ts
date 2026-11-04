import type { Diagnostic, Pipeline } from "@keelson/core";
import { LAYOUT_INVALID, LAYOUT_UNKNOWN_JOB, LAYOUT_UNKNOWN_LAYER } from "@keelson/core";
import { isLayerId, type LayerId } from "@keelson/taxonomy";
import { z } from "zod";

export const LAYOUT_FILE = ".devsecops/layout.json";

const layoutSchema = z.object({
  version: z.literal(1),
  layers: z.record(z.string(), z.array(z.string())).default({}),
});

export type ParsedLayout = {
  overrides: Readonly<Record<string, readonly LayerId[]>>;
  diagnostics: Diagnostic[];
};

function warn(found: Omit<Diagnostic, "severity" | "range" | "file">): Diagnostic {
  return { ...found, severity: "warning", range: null, file: LAYOUT_FILE } as Diagnostic;
}

function invalid(detail: string): ParsedLayout {
  return { overrides: {}, diagnostics: [warn({ code: LAYOUT_INVALID, params: { detail } })] };
}

/** Un fichier illisible n'empêche rien : la détection s'applique, et le diagnostic le dit. `text`
 *  nul veut dire que le fichier n'existe pas, ce qui est le cas normal. */
export function parseLayout(text: string | null, pipeline: Pipeline): ParsedLayout {
  if (text === null) {
    return { overrides: {}, diagnostics: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "unreadable JSON");
  }

  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    return invalid(`${path === "" ? "" : `${path}: `}${issue?.message ?? "invalid"}`);
  }

  const known = new Set(pipeline.jobs.map((job) => job.id));
  const diagnostics: Diagnostic[] = [];
  const overrides: Record<string, readonly LayerId[]> = {};

  for (const [job, layers] of Object.entries(parsed.data.layers)) {
    if (!known.has(job)) {
      diagnostics.push(warn({ code: LAYOUT_UNKNOWN_JOB, params: { job } }));
      continue;
    }
    for (const layer of layers.filter((entry) => !isLayerId(entry))) {
      diagnostics.push(warn({ code: LAYOUT_UNKNOWN_LAYER, params: { job, layer } }));
    }
    overrides[job] = layers.filter(isLayerId);
  }

  return { overrides, diagnostics };
}
