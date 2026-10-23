import type { Diagnostic, Environment, Need, Origin, SourceRange, Valued } from "@keelson/core";
import { EXTENDS_CYCLE, EXTENDS_TARGET_NOT_FOUND } from "@keelson/core";
import {
  type Document,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";

export const REFERENCE_TAG = "!reference";

export const MODELLED_JOB_KEYS = ["stage", "needs", "environment", "extends"] as const;

export type AnyNode = Node | null | undefined;

export const MERGE_KEY = "<<";

export function keyOf(pair: Pair<unknown, unknown>): string | null {
  const key = pair.key;
  if (!isScalar(key)) {
    return null;
  }
  if (typeof key.value === "string") {
    return key.value;
  }
  if (typeof key.value === "symbol") {
    const source = (key as { source?: unknown }).source;
    return source === MERGE_KEY ? MERGE_KEY : null;
  }
  return null;
}

function nodeRange(node: AnyNode): readonly [number, number, number] | undefined {
  const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
  return range === undefined ? undefined : range;
}

export function pairRange(pair: Pair<unknown, unknown>): SourceRange | null {
  const keyRange = nodeRange(pair.key as AnyNode);
  if (keyRange === undefined) {
    return null;
  }
  const valueRange = nodeRange(pair.value as AnyNode);
  return { start: keyRange[0], end: valueRange?.[2] ?? keyRange[2] };
}

export function contentRange(node: AnyNode): SourceRange | null {
  const range = nodeRange(node);
  return range === undefined ? null : { start: range[0], end: range[1] };
}

export function localPair(map: YAMLMap, key: string): Pair<unknown, unknown> | undefined {
  return map.items.find((item) => isPair(item) && keyOf(item) === key);
}

export function localPairs(map: YAMLMap): Pair<unknown, unknown>[] {
  return map.items.filter((item) => isPair(item));
}

function stringsOf(node: AnyNode): string[] {
  if (isScalar(node) && typeof node.value === "string") {
    return [node.value];
  }
  if (isSeq(node)) {
    return node.items.flatMap((item) =>
      isScalar(item) && typeof item.value === "string" ? [item.value] : [],
    );
  }
  return [];
}

export function extendsOf(map: YAMLMap): string[] {
  const pair = localPair(map, "extends");
  return pair === undefined ? [] : stringsOf(pair.value as AnyNode);
}

function anchorMerges(map: YAMLMap, document: Document.Parsed): { map: YAMLMap; name: string }[] {
  const merges: { map: YAMLMap; name: string }[] = [];

  for (const pair of localPairs(map)) {
    if (keyOf(pair) !== MERGE_KEY) {
      continue;
    }
    const value = pair.value as AnyNode;
    const aliases = isSeq(value) ? value.items : [value];
    for (const alias of aliases) {
      if (!isAlias(alias)) {
        continue;
      }
      const target = alias.resolve(document);
      if (isMap(target)) {
        merges.push({ map: target, name: alias.source });
      }
    }
  }

  return merges;
}

/** Une définition d'une clé de premier niveau, dans le fichier qui la porte. Une même clé peut en
 *  avoir plusieurs : un job défini dans un fichier inclus puis surchargé dans le principal. Elles
 *  sont toujours rangées dans l'ordre de fusion de GitLab, la dernière gagnant. */
export type Definition = {
  map: YAMLMap;
  file: string;
};

export type Source = {
  map: YAMLMap;
  origin: Origin;
  /** Le fichier d'où vient cette map. Les alias et les `!reference` se résolvent contre le
   *  document de **ce** fichier : un anchor n'existe que dans le fichier qui le déclare. */
  file: string;
};

export type ResolveContext = {
  documents: ReadonlyMap<string, Document.Parsed>;
  lookup: ReadonlyMap<string, readonly Definition[]>;
  diagnostics: Diagnostic[];
  extendsSeverity: "error" | "warning";
  /** Le fichier principal, le seul dont une valeur a l'origine `local`. */
  main: string;
};

function documentOf(context: ResolveContext, file: string): Document.Parsed | null {
  return context.documents.get(file) ?? null;
}

function originOf(context: ResolveContext, definition: Definition, fallback: Origin): Origin {
  return definition.file === context.main ? fallback : { kind: "include", file: definition.file };
}

export function sourcesFor(
  definitions: readonly Definition[],
  selfOrigin: Origin,
  context: ResolveContext,
  trail: readonly string[] = [],
): Source[] {
  const sources: Source[] = [];

  for (const definition of definitions) {
    const map = definition.map;
    const extendsRange = (): SourceRange | null =>
      pairRange(localPair(map, "extends") ?? ({} as Pair<unknown, unknown>));

    for (const template of extendsOf(map)) {
      if (trail.includes(template)) {
        push(context.diagnostics, {
          code: EXTENDS_CYCLE,
          severity: "error",
          params: { trail: [...trail, template] },
          range: extendsRange(),
          file: definition.file,
        });
        continue;
      }

      const target = context.lookup.get(template);
      if (target === undefined || target.length === 0) {
        push(context.diagnostics, {
          code: EXTENDS_TARGET_NOT_FOUND,
          severity: context.extendsSeverity,
          params: { template },
          range: extendsRange(),
          file: definition.file,
        });
        continue;
      }

      sources.push(
        ...sourcesFor(target, { kind: "extends", template }, context, [...trail, template]),
      );
    }

    const document = documentOf(context, definition.file);
    if (document !== null) {
      for (const merge of [...anchorMerges(map, document)].reverse()) {
        sources.push({
          map: merge.map,
          origin: { kind: "anchor", name: merge.name },
          file: definition.file,
        });
      }
    }

    sources.push({ map, origin: originOf(context, definition, selfOrigin), file: definition.file });
  }

  return sources;
}

/** Sérialisation à clés triées : le dédoublonnage portait sur le message, qui n'existe plus. Deux
 *  diagnostics de même code ne sont le même que si leurs `params` ont le même contenu — et pas
 *  seulement les mêmes clés dans le même ordre, qui dépend de l'ordre d'écriture du littéral. */
function stableParams(diagnostic: Diagnostic): string {
  const params = diagnostic.params as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .map((key) => [key, params[key]]),
  );
}

function push(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  const already = diagnostics.some(
    (existing) =>
      existing.code === diagnostic.code && stableParams(existing) === stableParams(diagnostic),
  );
  if (!already) {
    diagnostics.push(diagnostic);
  }
}

type Match = {
  node: AnyNode;
  origin: Origin;
  file: string;
};

function matches(sources: readonly Source[], key: string): Match[] {
  return sources.flatMap((source) => {
    const pair = localPair(source.map, key);
    return pair === undefined
      ? []
      : [{ node: pair.value as AnyNode, origin: source.origin, file: source.file }];
  });
}

export function definesKey(sources: readonly Source[], key: string): boolean {
  return matches(sources, key).length > 0;
}

/** Un alias et un `!reference` ne traversent **pas** les fichiers : chez GitLab, un anchor est
 *  local au document qui le déclare. Chacun est donc résolu contre le document du fichier d'où
 *  vient la map qui le porte, et pas contre le fichier principal. */
function dereference(
  node: AnyNode,
  file: string,
  context: ResolveContext,
): { node: AnyNode; origin: Origin | null } {
  const document = documentOf(context, file);
  if (document === null) {
    return { node, origin: null };
  }

  if (isAlias(node)) {
    return { node: node.resolve(document) ?? null, origin: null };
  }

  const tagged = node as { tag?: string } | null | undefined;
  if (tagged?.tag === REFERENCE_TAG && isSeq(node)) {
    const path = stringsOf(node);
    const target = document.getIn(path, true);
    return {
      node: (target ?? null) as AnyNode,
      origin: { kind: "reference", path },
    };
  }

  return { node, origin: null };
}

export function resolveStage(
  sources: readonly Source[],
  context: ResolveContext,
): Valued<string> | null {
  const found = matches(sources, "stage").at(-1);
  if (found === undefined) {
    return null;
  }

  const { node, origin } = dereference(found.node, found.file, context);
  if (!isScalar(node) || typeof node.value !== "string") {
    return null;
  }

  return { value: node.value, origin: origin ?? found.origin };
}

function needFrom(item: unknown): Need | null {
  if (isScalar(item) && typeof item.value === "string") {
    return { job: item.value, optional: false, artifacts: true };
  }

  if (!isMap(item)) {
    return null;
  }

  // DETTE(2026-10-20): les needs inter-projets (clés project / pipeline) sont ignorés de l'IR
  // — hors périmètre du lot L1, ils doivent devenir un bloc opaque porté par le job.
  if (localPair(item, "project") !== undefined || localPair(item, "pipeline") !== undefined) {
    return null;
  }

  const job = localPair(item, "job");
  const jobName = job === undefined ? null : (job.value as AnyNode);
  if (!isScalar(jobName) || typeof jobName.value !== "string") {
    return null;
  }

  const optional = localPair(item, "optional")?.value;
  const artifacts = localPair(item, "artifacts")?.value;

  return {
    job: jobName.value,
    optional: isScalar(optional) ? optional.value === true : false,
    artifacts: isScalar(artifacts) ? artifacts.value !== false : true,
  };
}

export function resolveNeeds(
  sources: readonly Source[],
  context: ResolveContext,
): Valued<Need[]> | null {
  const found = matches(sources, "needs").at(-1);
  if (found === undefined) {
    return null;
  }

  const { node, origin } = dereference(found.node, found.file, context);
  if (!isSeq(node)) {
    return null;
  }

  const value = node.items.flatMap((item) => {
    const need = needFrom(item);
    return need === null ? [] : [need];
  });

  return { value, origin: origin ?? found.origin };
}

function plainObject(node: AnyNode): Record<string, unknown> | null {
  if (!isMap(node)) {
    return null;
  }
  const json = node.toJSON() as unknown;
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : null;
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const key of Object.keys(overlay)) {
    const incoming = overlay[key];
    const existing = merged[key];
    const bothMaps =
      typeof incoming === "object" &&
      incoming !== null &&
      !Array.isArray(incoming) &&
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing);

    merged[key] = bothMaps
      ? deepMerge(existing as Record<string, unknown>, incoming as Record<string, unknown>)
      : incoming;
  }

  return merged;
}

function environmentFrom(raw: Record<string, unknown>): Environment | null {
  const name = raw.name;
  if (typeof name !== "string") {
    return null;
  }

  const environment: Environment = { name };
  if (typeof raw.url === "string") {
    environment.url = raw.url;
  }
  if (typeof raw.action === "string") {
    environment.action = raw.action;
  }
  return environment;
}

export function resolveEnvironment(
  sources: readonly Source[],
  context: ResolveContext,
): Valued<Environment> | null {
  const found = matches(sources, "environment");
  const last = found.at(-1);
  if (last === undefined) {
    return null;
  }

  const resolvedLast = dereference(last.node, last.file, context);
  const origin = resolvedLast.origin ?? last.origin;

  if (isScalar(resolvedLast.node) && typeof resolvedLast.node.value === "string") {
    return { value: { name: resolvedLast.node.value }, origin };
  }

  let merged: Record<string, unknown> = {};
  for (const match of found) {
    const object = plainObject(dereference(match.node, match.file, context).node);
    if (object !== null) {
      merged = deepMerge(merged, object);
    }
  }

  const environment = environmentFrom(merged);
  return environment === null ? null : { value: environment, origin };
}
