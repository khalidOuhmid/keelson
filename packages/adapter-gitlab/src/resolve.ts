import type {
  Diagnostic,
  Environment,
  JobSignals,
  Need,
  Origin,
  SourceRange,
  Valued,
} from "@keelson/core";
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
  /** Les documents dans l'ordre de fusion. Distinct de `documents`, qui ne garde d'un fichier inclus
   *  deux fois que sa première position : GitLab retient la dernière. */
  merged: readonly Document.Parsed[];
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

/** L'ordre des sources est l'ordre de précédence croissante : `matches(...).at(-1)` gagne.
 *
 *  Les `extends` de **toutes** les définitions passent d'abord, puis les définitions elles-mêmes.
 *  La version précédente les entrelaçait définition par définition, et le défaut était réel : un
 *  `extends: .base` écrit dans le fichier principal battait une valeur écrite **directement** dans
 *  la définition de l'include, parce que les sources du template arrivaient après la map de
 *  l'include. GitLab fusionne les includes puis le fichier principal, et ne résout `extends`
 *  qu'ensuite, sur le job fusionné : les clés propres d'un job battent toujours ses templates.
 *  Trouvé par la revue indépendante du 2026-10-23, qui plaçait le job dans la mauvaise colonne. */
export function sourcesFor(
  definitions: readonly Definition[],
  selfOrigin: Origin,
  context: ResolveContext,
  trail: readonly string[] = [],
): Source[] {
  const inherited: Source[] = [];
  const own: Source[] = [];

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

      inherited.push(
        ...sourcesFor(target, { kind: "extends", template }, context, [...trail, template]),
      );
    }

    const document = documentOf(context, definition.file);
    if (document !== null) {
      for (const merge of [...anchorMerges(map, document)].reverse()) {
        own.push({
          map: merge.map,
          origin: { kind: "anchor", name: merge.name },
          file: definition.file,
        });
      }
    }

    own.push({ map, origin: originOf(context, definition, selfOrigin), file: definition.file });
  }

  return [...inherited, ...own];
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

/** La valeur de `key` dans `node`, à travers les alias et les clés de fusion : `undefined` si la
 *  clé est absente, `null` si `node` n'est pas une map, c'est-à-dire si la valeur a remplacé toute
 *  map que les fichiers antérieurs auraient définie là. */
function entryAt(
  node: AnyNode,
  key: string,
  document: Document.Parsed,
  visited: Set<YAMLMap> = new Set(),
): AnyNode {
  const target = isAlias(node) ? node.resolve(document) : node;
  if (!isMap(target)) {
    return null;
  }

  const pair = localPair(target, key);
  if (pair !== undefined) {
    return pair.value as AnyNode;
  }

  // `job: &a` suivi de `<<: *a` est du YAML valide : une map peut se fusionner sur elle-même. Une
  // map déjà parcourue n'avait pas la clé : l'ensemble est partagé, un diamant reste linéaire.
  visited.add(target);
  for (const merge of anchorMerges(target, document)) {
    if (visited.has(merge.map)) {
      continue;
    }
    const merged = entryAt(merge.map, key, document, visited);
    if (merged !== undefined) {
      return merged;
    }
  }
  return undefined;
}

/** Le chemin dans un seul document, ou `undefined` s'il n'y figure pas. `Document.getIn` ne
 *  traverse ni alias ni clé de fusion : il rendait « absent » pour le fichier gagnant. */
function targetIn(path: readonly string[], document: Document.Parsed): AnyNode {
  let node: AnyNode = document.contents as AnyNode;
  for (const key of path) {
    node = entryAt(node, key, document);
    if (node === undefined || node === null) {
      return node;
    }
  }
  return isAlias(node) ? (node.resolve(document) ?? null) : node;
}

/** Un `!reference` vise la configuration fusionnée, donc il traverse les fichiers : on remonte
 *  l'ordre de fusion et le premier fichier qui définit le chemin gagne, comme pour une valeur. */
function referenceTarget(path: readonly string[], context: ResolveContext): AnyNode {
  for (const document of [...context.merged].reverse()) {
    const target = targetIn(path, document);
    if (target !== undefined) {
      return target;
    }
  }
  return null;
}

/** Un alias ne traverse **pas** les fichiers : chez GitLab, un anchor est local au document qui le
 *  déclare, donc il se résout contre le fichier d'où vient la map qui le porte. Un `!reference`,
 *  lui, les traverse. */
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
    return { node: referenceTarget(path, context), origin: { kind: "reference", path } };
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

function scriptLines(node: AnyNode, file: string, context: ResolveContext): string[] {
  const { node: target } = dereference(node, file, context);
  if (isScalar(target)) {
    return typeof target.value === "string" ? [target.value] : [];
  }
  return isSeq(target)
    ? target.items.flatMap((item) => scriptLines(item as AnyNode, file, context))
    : [];
}

const SCRIPT_SECTIONS = ["before_script", "script", "after_script"] as const;

/** Les clés que `inherit: default:` laisse passer : toutes, aucune, ou celles qu'il nomme. */
function inheritedKeys(
  sources: readonly Source[],
  context: ResolveContext,
): ReadonlySet<string> | null {
  // GitLab fusionne `inherit` en profondeur à travers `extends` : le `default` le plus proche gagne,
  // même si un `inherit` plus proche ne parle que de `variables`. `<<` ne fusionne pas en profondeur :
  // `entryAt` lit donc l'`inherit` effectif de chaque définition, ancres comprises.
  const value = sources
    .filter((source) => source.origin.kind !== "anchor")
    .toReversed()
    .map((source) => {
      const document = documentOf(context, source.file);
      const entry = document === null ? undefined : entryAt(source.map, "inherit", document);
      const map = entry === undefined ? null : dereference(entry, source.file, context).node;
      return isMap(map) ? (localPair(map, "default")?.value as AnyNode) : undefined;
    })
    .find((entry) => entry !== undefined);
  if (isScalar(value) && value.value === false) {
    return new Set();
  }
  return isSeq(value) ? new Set(stringsOf(value)) : null;
}

/** Ce qui s'applique sous tous les jobs d'un fichier : `default:`, et les clés globales dépréciées
 *  mais valides. Le script n'en fait pas partie : un `script` de premier niveau n'existe pas. */
export function defaultSources(root: YAMLMap, file: string, context: ResolveContext): Source[] {
  const document = documentOf(context, file);
  const value = localPair(root, "default")?.value as AnyNode;
  const target = isAlias(value) && document !== null ? value.resolve(document) : value;
  const origin: Origin = { kind: "default" };
  const merged =
    isMap(target) && document !== null
      ? anchorMerges(target, document)
          .reverse()
          .map((merge) => ({ map: merge.map, origin, file }))
      : [];
  return [
    { map: root, origin, file },
    ...merged,
    ...(isMap(target) ? [{ map: target, origin, file }] : []),
  ];
}

/** `extends` fusionne les maps : `image: { entrypoint }` garde le `name` du template. Un scalaire
 *  arrête la remontée, et un `name` écrit aussi. */
function imageOf(found: readonly Match[], context: ResolveContext): string | null {
  for (const source of found.toReversed()) {
    const image = dereference(source.node, source.file, context).node;
    const document = documentOf(context, source.file);
    const named =
      isMap(image) && document !== null
        ? dereference(entryAt(image, "name", document), source.file, context).node
        : image;
    if (isScalar(named) && named.value !== null) {
      return typeof named.value === "string" ? named.value : null;
    }
    if (!isMap(image)) {
      return null;
    }
  }
  return null;
}

export function resolveSignals(
  sources: readonly Source[],
  defaults: readonly Source[],
  context: ResolveContext,
): JobSignals {
  // Un job `trigger` crée un pipeline : ni image ni script ne s'y exécutent, `default:` compris.
  if (matches(sources, "trigger").length > 0) {
    return { image: null, script: [] };
  }

  const inherited = inheritedKeys(sources, context);
  const candidates = (key: string) =>
    matches([...(inherited === null || inherited.has(key) ? defaults : []), ...sources], key);
  const find = (key: string) => candidates(key).at(-1);

  const sections = SCRIPT_SECTIONS.map((key) =>
    key === "script" ? matches(sources, key).at(-1) : find(key),
  );

  return {
    image: imageOf(candidates("image"), context),
    script: sections.flatMap((section) =>
      section === undefined ? [] : scriptLines(section.node, section.file, context),
    ),
  };
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
