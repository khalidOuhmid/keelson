import type { Diagnostic, Pipeline } from "@keelson/core";
import {
  INVALID_YAML,
  isPartial,
  LAYOUT_INVALID,
  LAYOUT_UNKNOWN_JOB,
  LAYOUT_UNKNOWN_LAYER,
  LAYOUT_UNREAD_JOB,
} from "@keelson/core";
import { isLayerId, type LayerId } from "@keelson/taxonomy";
import { z } from "zod";

export const LAYOUT_FILE = ".devsecops/layout.json";

export type Position = { x: number; y: number };

export type Positions = Readonly<Record<string, Position>>;

const position = z.strictObject({ x: z.number(), y: z.number() });
const layerList = z.array(z.string());

const positionsSchema = z.record(z.string(), position);

const layoutSchema = z.object({
  version: z.literal(1),
  layers: z.record(z.string(), layerList).default({}),
  positions: positionsSchema.default({}),
});

type Checked<T> = { ok: true; value: T } | { ok: false; path: string; detail: string };

function failed(error: z.ZodError, prefix: readonly string[]): Checked<never> {
  const issue = error.issues[0];
  return {
    ok: false,
    path: [...prefix, ...(issue?.path ?? []).map(String)].join("."),
    detail: issue?.message ?? "invalid shape",
  };
}

const PROTO = "__proto__";

/** `zod` neither checks nor returns an own `__proto__` key: it is checked here and put back, in
 *  its place. */
function withProto<T>(
  raw: unknown,
  parsed: Record<string, T>,
  item: z.ZodType<T>,
  prefix: readonly string[],
): Checked<Record<string, T>> {
  if (raw === null || typeof raw !== "object" || !Object.hasOwn(raw, PROTO)) {
    return { ok: true, value: parsed };
  }
  const own = item.safeParse(Object.getOwnPropertyDescriptor(raw, PROTO)?.value);
  if (!own.success) {
    return failed(own.error, [...prefix, PROTO]);
  }
  return {
    ok: true,
    value: Object.fromEntries(
      Object.keys(raw).map((key) => [key, key === PROTO ? own.data : (parsed[key] as T)]),
    ),
  };
}

type Layout = { layers: Record<string, string[]>; positions: Record<string, Position> };

function readLayout(raw: unknown): Checked<Layout> {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) {
    return failed(parsed.error, []);
  }
  const source = raw as { layers?: unknown; positions?: unknown };
  const layers = withProto(source.layers, parsed.data.layers, layerList, ["layers"]);
  if (!layers.ok) {
    return layers;
  }
  const positions = withProto(source.positions, parsed.data.positions, position, ["positions"]);
  if (!positions.ok) {
    return positions;
  }
  return { ok: true, value: { layers: layers.value, positions: positions.value } };
}

export type ParsedPositions =
  | { ok: true; positions: Positions }
  | { ok: false; path: string; detail: string };

export function parsePositions(raw: unknown): ParsedPositions {
  const parsed = positionsSchema.safeParse(raw);
  const checked = parsed.success
    ? withProto(raw, parsed.data, position, [])
    : failed(parsed.error, []);
  return checked.ok ? { ok: true, positions: checked.value } : checked;
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

/** An unreadable file blocks nothing: detection applies, and the diagnostic says so. A null `text`
 *  means the file does not exist, which is the normal case. `parsing` are the diagnostics of the CI
 *  files: on a pipeline read in part, a job the file names may be in the part that was not read. */
export function parseLayout(
  text: string | null,
  pipeline: Pipeline,
  parsing: readonly Diagnostic[] = [],
): ParsedLayout {
  if (text === null) {
    return { overrides: {}, positions: {}, diagnostics: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "unreadable JSON");
  }

  const read = readLayout(raw);
  if (!read.ok) {
    return invalid(`${read.path === "" ? "" : `${read.path}: `}${read.detail}`);
  }

  const known = new Set(pipeline.jobs.map((job) => job.id));
  const partial = isPartial(pipeline) || parsing.some((entry) => entry.code === INVALID_YAML);
  const diagnostics: Diagnostic[] = [];
  const overrides: [string, readonly LayerId[]][] = [];

  for (const [job, layers] of Object.entries(read.value.layers)) {
    if (!known.has(job)) {
      diagnostics.push(
        warn({ code: partial ? LAYOUT_UNREAD_JOB : LAYOUT_UNKNOWN_JOB, params: { job } }),
      );
      if (!partial) {
        continue;
      }
    }
    for (const layer of layers.filter((entry) => !isLayerId(entry))) {
      diagnostics.push(warn({ code: LAYOUT_UNKNOWN_LAYER, params: { job, layer } }));
    }
    overrides.push([job, layers.filter(isLayerId)]);
  }

  return {
    overrides: Object.fromEntries(overrides),
    positions: read.value.positions,
    diagnostics,
  };
}

/** The text of `layout.json` with these positions added, or `null` if the current file is not
 *  understood: Keelson does not overwrite what it cannot read. Keys it ignores and positions written
 *  by someone else survive, unless `clear` asks for every saved position to go first. */
export function writePositions(
  text: string | null,
  positions: Positions,
  options: { clear?: boolean } = {},
): string | null {
  let current: unknown = { version: 1 };
  if (text !== null) {
    try {
      current = JSON.parse(text);
    } catch {
      return null;
    }
  }
  const read = readLayout(current);
  if (!read.ok) {
    return null;
  }

  const sorted = Object.fromEntries(
    Object.entries({ ...(options.clear === true ? {} : read.value.positions), ...positions }).sort(
      ([left], [right]) => (left < right ? -1 : 1),
    ),
  );
  return `${JSON.stringify({ ...(current as object), positions: sorted }, null, 2)}\n`;
}
