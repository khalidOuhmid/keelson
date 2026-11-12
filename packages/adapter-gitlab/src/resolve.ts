import type {
  Diagnostic,
  Environment,
  JobSignals,
  Need,
  OpaqueBlock,
  Origin,
  SourceRange,
  Valued,
} from "@keelson/core";
import {
  EXTENDS_CYCLE,
  EXTENDS_DEPTH_EXCEEDED,
  EXTENDS_TARGET_NOT_FOUND,
  VALUE_CYCLE,
} from "@keelson/core";
import {
  type Alias,
  type Document,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  visit,
  type YAMLMap,
} from "yaml";
import { MAX_EXTENDS_DEPTH } from "./defaults.ts";

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

const aliasTargets = new WeakMap<Document.Parsed, Map<Alias, Node | undefined>>();

/** `alias.resolve(document)`, which walks the whole document on every call, read from one walk
 *  per document: the last node carrying the anchor before the alias. */
export function resolveAlias(alias: Alias, document: Document.Parsed): Node | undefined {
  let targets = aliasTargets.get(document);
  if (targets === undefined) {
    const table = new Map<Alias, Node | undefined>();
    const anchors = new Map<string, Node>();
    visit(document, {
      Node: (_key, node) => {
        if (isAlias(node)) {
          table.set(node, anchors.get(node.source));
        } else if (typeof node.anchor === "string") {
          anchors.set(node.anchor, node);
        }
      },
    });
    aliasTargets.set(document, table);
    targets = table;
  }
  return targets.has(alias) ? targets.get(alias) : alias.resolve(document);
}

/** A value written in a map, and the anchor it was merged from, if any. */
export type Write = { node: AnyNode; anchor: string | null; pair: Pair<unknown, unknown> };

type Walk = { path: Set<YAMLMap>; memo: Map<YAMLMap, Write | undefined> };

function mergedWrite(
  value: AnyNode,
  key: string,
  document: Document.Parsed,
  walk: Walk,
): Write | undefined {
  const target = isAlias(value) ? resolveAlias(value, document) : value;
  if (!isMap(target) || walk.path.has(target)) {
    return undefined;
  }
  const found = walk.memo.has(target)
    ? walk.memo.get(target)
    : writeIn(target, key, document, walk);
  if (found === undefined) {
    return undefined;
  }
  return isAlias(value) ? { ...found, anchor: value.source } : found;
}

/** The value of `key` in `map` as Psych — the parser GitLab loads its YAML with — reads it: a
 *  merge key writes the merged map's keys at its own position, and a later write wins. Of a merge
 *  list, the first map wins. A map already being read is skipped: `j: &j { <<: *j }` is `j`.
 *  Each map is read once per lookup, so that diamond merges stay linear. */
export function lastWrite(map: YAMLMap, key: string, document: Document.Parsed): Write | undefined {
  return writeIn(map, key, document, { path: new Set(), memo: new Map() });
}

function writeIn(
  map: YAMLMap,
  key: string,
  document: Document.Parsed,
  walk: Walk,
): Write | undefined {
  walk.path.add(map);
  let found: Write | undefined;
  for (const pair of localPairs(map)) {
    const name = keyOf(pair);
    if (name === MERGE_KEY) {
      const value = pair.value as AnyNode;
      const merged = isSeq(value)
        ? value.items
            .map((item) => mergedWrite(item as AnyNode, key, document, walk))
            .find((write) => write !== undefined)
        : mergedWrite(value, key, document, walk);
      found = merged ?? found;
    } else if (name === key) {
      found = { node: pair.value as AnyNode, anchor: null, pair };
    }
  }
  walk.path.delete(map);
  walk.memo.set(map, found);
  return found;
}

export function extendsOf(map: YAMLMap, document: Document.Parsed | null): string[] {
  if (document === null) {
    const pair = localPair(map, "extends");
    return pair === undefined ? [] : stringsOf(pair.value as AnyNode);
  }
  const node = lastWrite(map, "extends", document)?.node;
  return stringsOf(isAlias(node) ? (resolveAlias(node, document) as AnyNode) : node);
}

/** A definition of a top-level key, in the file that carries it. The same key can have several: a
 *  job defined in an included file then overridden in the main one. They are always kept in
 *  GitLab's merge order, the last one winning. */
export type Definition = {
  map: YAMLMap;
  file: string;
};

export type Source = {
  map: YAMLMap;
  origin: Origin;
  /** The file this map comes from. Aliases and `!reference`s resolve against the document of
   *  **this** file: an anchor only exists in the file that declares it. */
  file: string;
  document: Document.Parsed | null;
};

export type ResolveContext = {
  documents: ReadonlyMap<string, Document.Parsed>;
  /** The documents in merge order. Distinct from `documents`, which keeps only the first position
   *  of a file included twice: GitLab retains the last. */
  merged: readonly { file: string; document: Document.Parsed }[];
  lookup: ReadonlyMap<string, readonly Definition[]>;
  diagnostics: Diagnostic[];
  extendsSeverity: "error" | "warning";
  /** The main file, the only one whose values have the `local` origin. */
  main: string;
  /** The job being resolved, named by the diagnostics found on the way. */
  job: string;
};

function documentOf(context: ResolveContext, file: string): Document.Parsed | null {
  return context.documents.get(file) ?? null;
}

function originOf(context: ResolveContext, definition: Definition, fallback: Origin): Origin {
  return definition.file === context.main ? fallback : { kind: "include", file: definition.file };
}

/** The order of the sources is increasing precedence: `matches(...).at(-1)` wins.
 *
 *  The `extends` of **all** definitions come first, then the definitions themselves. The previous
 *  version interleaved them definition by definition, and the defect was real: an `extends: .base`
 *  written in the main file beat a value written **directly** in the include's definition,
 *  because the template's sources arrived after the include's map. GitLab merges the includes
 *  then the main file, and only resolves `extends` afterwards, on the merged job: a job's own
 *  keys always beat its templates. Found by the independent review of 2026-10-23, which put the
 *  job in the wrong column. */
export function sourcesFor(
  definitions: readonly Definition[],
  selfOrigin: Origin,
  context: ResolveContext,
  trail: readonly string[] = [],
): Source[] {
  const inherited: Source[] = [];
  const own: Source[] = definitions.map((definition) => ({
    map: definition.map,
    origin: originOf(context, definition, selfOrigin),
    file: definition.file,
    document: documentOf(context, definition.file),
  }));

  // `extends` is a string or a list: GitLab's merge of an include with the main file replaces it,
  // it does not add to it. Only the last definition that writes one counts.
  const carrier = definitions.findLast(
    (definition) => extendsOf(definition.map, documentOf(context, definition.file)).length > 0,
  );
  if (carrier === undefined) {
    return own;
  }
  const extendsRange = (): SourceRange | null => {
    const pair = localPair(carrier.map, "extends");
    return pair === undefined ? null : pairRange(pair);
  };

  for (const template of extendsOf(carrier.map, documentOf(context, carrier.file))) {
    if (trail.includes(template)) {
      push(context.diagnostics, {
        code: EXTENDS_CYCLE,
        severity: "error",
        params: { trail: [...trail, template] },
        range: extendsRange(),
        file: carrier.file,
      });
      continue;
    }

    if (trail.length + 1 > MAX_EXTENDS_DEPTH) {
      push(context.diagnostics, {
        code: EXTENDS_DEPTH_EXCEEDED,
        severity: "error",
        params: { job: context.job, limit: MAX_EXTENDS_DEPTH },
        range: extendsRange(),
        file: carrier.file,
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
        file: carrier.file,
      });
      continue;
    }

    inherited.push(
      ...sourcesFor(target, { kind: "extends", template }, context, [...trail, template]),
    );
  }

  return [...inherited, ...own];
}

/** The `extends` GitLab applies to a job: those of its last definition that writes one. */
export function effectiveExtends(
  definitions: readonly Definition[],
  context: ResolveContext,
): string[] {
  for (const definition of definitions.toReversed()) {
    const found = extendsOf(definition.map, documentOf(context, definition.file));
    if (found.length > 0) {
      return [...new Set(found)];
    }
  }
  return [];
}

/** The templates a definition merges through its own merge keys, `<<: *anchor` or a list of
 *  them, across every definition in merge order. Only an anchor on a template's own map names a
 *  template: one on a job or a nested value names nothing that is drawn. */
export function effectiveMerges(
  definitions: readonly Definition[],
  context: ResolveContext,
  templates: ReadonlyMap<YAMLMap, string>,
): string[] {
  const names = definitions.flatMap((definition) => {
    const document = documentOf(context, definition.file);
    if (document === null) {
      return [];
    }
    return localPairs(definition.map)
      .filter((pair) => keyOf(pair) === MERGE_KEY)
      .flatMap((pair) => {
        const value = pair.value as AnyNode;
        return isSeq(value) ? (value.items as AnyNode[]) : [value];
      })
      .flatMap((item) => {
        const target = isAlias(item) ? resolveAlias(item, document) : undefined;
        const name = isMap(target) ? templates.get(target) : undefined;
        return name === undefined ? [] : [name];
      });
  });
  return [...new Set(names)];
}

/** Serialisation with sorted keys: deduplication used to rely on the message, which no longer
 *  exists. Two diagnostics with the same code are only the same if their `params` have the same
 *  content — and not merely the same keys in the same order, which depends on the literal's
 *  written order. */
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
  pair: Pair<unknown, unknown>;
  origin: Origin;
  file: string;
};

function matches(sources: readonly Source[], key: string): Match[] {
  return sources.flatMap((source) => {
    if (source.document === null) {
      const pair = localPair(source.map, key);
      return pair === undefined
        ? []
        : [{ node: pair.value as AnyNode, pair, origin: source.origin, file: source.file }];
    }
    const found = lastWrite(source.map, key, source.document);
    if (found === undefined) {
      return [];
    }
    const origin: Origin =
      found.anchor === null ? source.origin : { kind: "anchor", name: found.anchor };
    return [{ node: found.node, pair: found.pair, origin, file: source.file }];
  });
}

export function definesKey(sources: readonly Source[], key: string): boolean {
  return matches(sources, key).length > 0;
}

/** The value of `key` in `node`, through aliases and merge keys: `undefined` if the key is absent,
 *  `null` if `node` is not a map, that is if the value replaced any map that earlier files would
 *  have defined there. */
function entryAt(node: AnyNode, key: string, document: Document.Parsed): AnyNode {
  const target = isAlias(node) ? node.resolve(document) : node;
  if (!isMap(target)) {
    return null;
  }
  return lastWrite(target, key, document)?.node;
}

/** The path in a single document, or `undefined` if it is not there. `Document.getIn` traverses
 *  neither aliases nor merge keys: it returned “absent” for the winning file. */
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

/** A node and the file whose anchors it resolves against. */
export type Layer = { node: AnyNode; file: string };

/** A `!reference` targets the merged configuration, so it crosses files: we walk back up the
 *  merge order and the first file that defines the path wins, as for a value. A map is deep-merged
 *  with the maps earlier files write at the same path, down to the first value that is not one:
 *  the layers come back in merge order, the winner last. */
function referenceTarget(path: readonly string[], context: ResolveContext): Layer[] {
  const layers: Layer[] = [];
  for (const { file, document } of context.merged.toReversed()) {
    const node = targetIn(path, document);
    if (node === undefined) {
      continue;
    }
    if (!isMap(node)) {
      if (layers.length === 0) {
        layers.push({ node, file });
      }
      break;
    }
    layers.unshift({ node, file });
  }
  return layers.length === 0 ? [{ node: null, file: context.main }] : layers;
}

/** An alias does **not** cross files: in GitLab, an anchor is local to the document that declares
 *  it, so it resolves against the file the map carrying it comes from. A `!reference`, on the
 *  other hand, crosses them, and can target another `!reference`: the chain is followed, and a
 *  loop in it is a `VALUE_CYCLE`. */
function dereference(
  node: AnyNode,
  file: string,
  context: ResolveContext,
  key: string,
): Layer & { origin: Origin | null; layers: readonly Layer[] } {
  const document = documentOf(context, file);
  if (document === null) {
    return { node, file, origin: null, layers: [{ node, file }] };
  }

  let layers: readonly Layer[] = [
    { node: isAlias(node) ? (node.resolve(document) ?? null) : node, file },
  ];
  let origin: Origin | null = null;
  const seen = new Set<string>();
  for (;;) {
    const winner = layers.at(-1) ?? { node: null, file };
    const current = winner.node;
    if (!isSeq(current) || (current as { tag?: string }).tag !== REFERENCE_TAG) {
      return { ...winner, origin, layers };
    }
    const path = stringsOf(current);
    const step = JSON.stringify(path);
    if (seen.has(step)) {
      cycle(context, key, node, file);
      return { node: null, file, origin, layers: [{ node: null, file }] };
    }
    seen.add(step);
    origin ??= { kind: "reference", path };
    layers = referenceTarget(path, context);
  }
}

function cycle(context: ResolveContext, key: string, node: AnyNode, file: string): void {
  push(context.diagnostics, {
    code: VALUE_CYCLE,
    severity: "error",
    params: { job: context.job, key },
    range: contentRange(node),
    file,
  });
}

export function resolveStage(
  sources: readonly Source[],
  context: ResolveContext,
): Valued<string> | null {
  const found = matches(sources, "stage").at(-1);
  if (found === undefined) {
    return null;
  }

  const { node, origin } = dereference(found.node, found.file, context, "stage");
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

  // A cross-project item is not a job of this pipeline: the job carries the list as an opaque
  // block instead (`unmodelledNeedsBlock`).
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

  const { node, origin } = dereference(found.node, found.file, context, "needs");
  if (!isSeq(node)) {
    return null;
  }

  const value = node.items.flatMap((item) => {
    const need = needFrom(item);
    return need === null ? [] : [need];
  });

  return { value, origin: origin ?? found.origin };
}

/** A `project:` or `pipeline:` item in the effective `needs` list. */
/** Allowlist, not denylist: only what `needFrom` renders identically can be rewritten from the
 *  IR. An alias, a `!reference`, one more key, and the rewrite would lose something. */
function modelledNeed(item: AnyNode): boolean {
  if (isScalar(item)) {
    return typeof item.value === "string";
  }
  if (!isMap(item)) {
    return false;
  }
  const job = localPair(item, "job")?.value;
  return (
    isScalar(job) &&
    typeof job.value === "string" &&
    item.items.every((pair) => {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      return (
        key === "job" ||
        ((key === "optional" || key === "artifacts") &&
          isScalar(pair.value) &&
          typeof pair.value.value === "boolean")
      );
    })
  );
}

export function hasUnmodelledNeeds(sources: readonly Source[]): boolean {
  const found = matches(sources, "needs").at(-1);
  if (found === undefined) {
    return false;
  }
  const list = found.node;
  const literal = isSeq(list) && (list as { tag?: string }).tag !== REFERENCE_TAG;
  return !literal || !list.items.every((item) => modelledNeed(item as AnyNode));
}

/** The `needs` list a job runs with, as written, when it carries items the IR drops — a
 *  cross-project or nested item: the screen shows the list verbatim instead of losing them. */
export function unmodelledNeedsBlock(
  sources: readonly Source[],
  context: ResolveContext,
): OpaqueBlock | null {
  const found = matches(sources, "needs").at(-1);
  if (found === undefined) {
    return null;
  }
  const list = dereference(found.node, found.file, context, "needs").node;
  const dropped = isSeq(list) && list.items.some((item) => needFrom(item) === null);
  const range = pairRange(found.pair);
  return dropped && range !== null ? { key: "needs", range, file: found.file } : null;
}

function scriptLines(
  node: AnyNode,
  file: string,
  context: ResolveContext,
  key: string,
  path: Set<Node> = new Set(),
): string[] {
  const { node: target, file: owner } = dereference(node, file, context, key);
  if (isScalar(target)) {
    return typeof target.value === "string" ? [target.value] : [];
  }
  if (!isSeq(target)) {
    return [];
  }
  if (path.has(target)) {
    cycle(context, key, node, file);
    return [];
  }
  path.add(target);
  const lines = target.items.flatMap((item) =>
    scriptLines(item as AnyNode, owner, context, key, path),
  );
  path.delete(target);
  return lines;
}

const SCRIPT_SECTIONS = ["before_script", "script", "after_script"] as const;

/** The keys that `inherit: default:` lets through: all, none, or the ones it names. */
function inheritedKeys(
  sources: readonly Source[],
  context: ResolveContext,
): ReadonlySet<string> | null {
  // GitLab deep-merges `inherit` across `extends`: the closest `default` wins, even if a closer
  // `inherit` only mentions `variables`. Within one definition, merge keys are shallow, which
  // `lastWrite` reads.
  const layers = sources.flatMap((source) => {
    if (source.document === null) {
      return [];
    }
    const entry = lastWrite(source.map, "inherit", source.document)?.node;
    return entry === undefined ? [] : dereference(entry, source.file, context, "inherit").layers;
  });
  const written = layers
    .toReversed()
    .map((layer) => {
      const document = documentOf(context, layer.file);
      const entry =
        isMap(layer.node) && document !== null
          ? lastWrite(layer.node, "default", document)?.node
          : undefined;
      return entry === undefined ? undefined : { node: entry, file: layer.file };
    })
    .find((entry) => entry !== undefined);
  if (written === undefined) {
    return null;
  }
  const { node: value, file } = dereference(written.node, written.file, context, "inherit");
  if (isScalar(value) && value.value === false) {
    return new Set();
  }
  const document = documentOf(context, file);
  if (!isSeq(value) || document === null) {
    return null;
  }
  return new Set(
    value.items.flatMap((item) => {
      const name = isAlias(item) ? item.resolve(document) : item;
      return isScalar(name) && typeof name.value === "string" ? [name.value] : [];
    }),
  );
}

/** What applies under every job of a file: `default:`, and the deprecated but valid global keys.
 *  The script is not one of them: a top-level `script` does not exist. */
export function defaultSources(root: YAMLMap, file: string, context: ResolveContext): Source[] {
  const document = documentOf(context, file);
  const value =
    document === null
      ? (localPair(root, "default")?.value as AnyNode)
      : lastWrite(root, "default", document)?.node;
  const target = isAlias(value) && document !== null ? value.resolve(document) : value;
  const origin: Origin = { kind: "default" };
  return [
    { map: root, origin, file, document },
    ...(isMap(target) ? [{ map: target, origin, file, document }] : []),
  ];
}

/** `extends` merges maps: `image: { entrypoint }` keeps the template's `name`. A scalar stops the
 *  walk up, and so does a written `name`. */
function imageOf(found: readonly Match[], context: ResolveContext): string | null {
  const layers = found.flatMap(
    (source) => dereference(source.node, source.file, context, "image").layers,
  );
  for (const { node: image, file } of layers.toReversed()) {
    const document = documentOf(context, file);
    const named =
      isMap(image) && document !== null
        ? dereference(entryAt(image, "name", document), file, context, "image").node
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
  // A `trigger` job creates a pipeline: neither image nor script runs in it, `default:` included.
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
    script: sections.flatMap((section, index) =>
      section === undefined
        ? []
        : scriptLines(section.node, section.file, context, SCRIPT_SECTIONS[index] ?? "script"),
    ),
  };
}

const ENVIRONMENT_FIELDS = ["name", "url", "action"] as const;

/** `extends` and `include` deep-merge an environment written as a map, and a string or `null`
 *  replaces it whole: `environment: null` is how a job cancels an inherited one. */
export function resolveEnvironment(
  sources: readonly Source[],
  context: ResolveContext,
): Valued<Environment> | null {
  const found = matches(sources, "environment");
  const last = found.at(-1);
  if (last === undefined) {
    return null;
  }

  let fields: Partial<Record<(typeof ENVIRONMENT_FIELDS)[number], string>> = {};
  let fromMap = false;
  let origin: Origin = last.origin;
  for (const match of found) {
    const resolved = dereference(match.node, match.file, context, "environment");
    origin = resolved.origin ?? match.origin;
    for (const layer of resolved.layers) {
      const document = documentOf(context, layer.file);
      if (!isMap(layer.node) || document === null) {
        const name = isScalar(layer.node) ? layer.node.value : null;
        fields = typeof name === "string" ? { name } : {};
        fromMap = false;
        continue;
      }
      if (!fromMap) {
        fields = {};
      }
      fromMap = true;
      for (const field of ENVIRONMENT_FIELDS) {
        const value = dereference(
          entryAt(layer.node, field, document),
          layer.file,
          context,
          "environment",
        ).node;
        if (isScalar(value) && typeof value.value === "string") {
          fields[field] = value.value;
        }
      }
    }
  }

  if (fields.name === undefined) {
    return null;
  }
  const environment: Environment = { name: fields.name };
  if (fields.url !== undefined) {
    environment.url = fields.url;
  }
  if (fields.action !== undefined) {
    environment.action = fields.action;
  }
  return { value: environment, origin };
}
