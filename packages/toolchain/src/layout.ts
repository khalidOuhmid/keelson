import type { Diagnostic, Pipeline } from "@keelson/core";
import { LAYOUT_INVALID, LAYOUT_UNKNOWN_JOB, LAYOUT_UNKNOWN_LAYER } from "@keelson/core";
import { isLayerId, type LayerId } from "@keelson/taxonomy";
import { z } from "zod";

export const LAYOUT_FILE = ".devsecops/layout.json";

export type Position = { x: number; y: number };

export type Positions = Readonly<Record<string, Position>>;

const positionsSchema = z.record(z.string(), z.strictObject({ x: z.number(), y: z.number() }));

const layoutSchema = z.object({
  version: z.literal(1),
  layers: z.record(z.string(), z.array(z.string())).default({}),
  positions: positionsSchema.default({}),
});

export type ParsedPositions =
  | { ok: true; positions: Positions }
  | { ok: false; path: string; detail: string };

export function parsePositions(raw: unknown): ParsedPositions {
  const parsed = positionsSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, positions: parsed.data };
  }
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    path: issue?.path.join(".") ?? "",
    detail: issue?.message ?? "invalid shape",
  };
}

export type ParsedLayout = {
  overrides: Readonly<Record<string, readonly LayerId[]>>;
  positions: Positions;
  diagnostics: Diagnostic[];
};

function warn(found: Omit<Diagnostic, "severity" | "range" | "file">): Diagnostic {
  return { ...found, severity: "warning", range: null, file: LAYOUT_FILE } as Diagnostic;
}

function invalid(detail: string): ParsedLayout {
  return {
    overrides: {},
    positions: {},
    diagnostics: [warn({ code: LAYOUT_INVALID, params: { detail } })],
  };
}

/** Un fichier illisible n'empêche rien : la détection s'applique, et le diagnostic le dit. `text`
 *  nul veut dire que le fichier n'existe pas, ce qui est le cas normal. */
export function parseLayout(text: string | null, pipeline: Pipeline): ParsedLayout {
  if (text === null) {
    return { overrides: {}, positions: {}, diagnostics: [] };
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

  return { overrides, positions: parsed.data.positions, diagnostics };
}

/** Le texte de `layout.json` avec ces positions, ou `null` si le fichier actuel n'est pas compris :
 *  Keelson n'écrase pas ce qu'il ne sait pas lire. Les clés qu'il ignore survivent. */
export function writePositions(text: string | null, positions: Positions): string | null {
  let current: unknown = { version: 1 };
  if (text !== null) {
    try {
      current = JSON.parse(text);
    } catch {
      return null;
    }
    if (!layoutSchema.safeParse(current).success) {
      return null;
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(positions).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
  return `${JSON.stringify({ ...(current as object), positions: sorted }, null, 2)}\n`;
}
