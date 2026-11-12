import type {
  Diagnostic,
  Job,
  OpaqueBlock,
  Pipeline,
  SourceRange,
  Stage,
  Template,
  UnresolvedInclude,
} from "@keelson/core";
import {
  emptyPipeline,
  hashText,
  INCLUDE_UNRESOLVED,
  INVALID_YAML,
  JOB_WITHOUT_SCRIPT,
} from "@keelson/core";
import type { Document } from "yaml";
import { isMap, isSeq, type YAMLMap } from "yaml";
import {
  DEFAULT_STAGE,
  DEFAULT_STAGES,
  FIRST_STAGE,
  isReservedTopLevel,
  LAST_STAGE,
} from "./defaults.ts";
import type { GitlabDocument } from "./document.ts";
import {
  type IncludeReader,
  type ParsedFile,
  parseIncludedFile,
  resolveIncludes,
} from "./includes.ts";
import {
  type AnyNode,
  contentRange,
  type Definition,
  defaultSources,
  definesKey,
  effectiveExtends,
  effectiveMerges,
  hasUnmodelledNeeds,
  keyOf,
  localPair,
  localPairs,
  MODELLED_JOB_KEYS,
  pairRange,
  type ResolveContext,
  resolveEnvironment,
  resolveNeeds,
  resolveSignals,
  resolveStage,
  type Source,
  sourcesFor,
  unmodelledNeedsBlock,
} from "./resolve.ts";

/** The conventional name of the entry file. Serves as the default when the caller has no path to
 *  give — a bare `parse(text)`, in a test or a tool. */
export const GITLAB_CI_FILE = ".gitlab-ci.yml";

export type ParseOptions = {
  /** Path of the main file, relative to the repository root. */
  file?: string;
  /** Absent ⇒ no `include` is resolved, and each one is reported by its form. */
  read?: IncludeReader | undefined;
};

export type ParseResult = {
  document: GitlabDocument;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  /** The text of each included file, as it was read for **this** parse. It is the only source
   *  guaranteed to be consistent with the IR's ranges: re-reading the files later would yield
   *  other bytes if one of them changed in the meantime. */
  included: Record<string, string>;
};

const SCRIPT_KEYS = ["script", "run", "trigger"] as const;

function emptyRange(): SourceRange {
  return { start: 0, end: 0 };
}

function defaultStages(main: string): Stage[] {
  return DEFAULT_STAGES.map((name) => ({ name, implicit: true, range: null, file: main }));
}

/** A file's `stages` list, or `null` if it declares no usable one. A list **overrides** and does
 *  not merge (“arrays cannot be merged”): that is why the caller only keeps the last one in merge
 *  order, instead of concatenating them. */
function declaredStages(root: YAMLMap, file: string): Stage[] | null {
  const pair = localPair(root, "stages");
  if (pair === undefined) {
    return null;
  }

  const seq = pair.value as AnyNode;
  if (!isSeq(seq)) {
    return null;
  }

  const stages = seq.items.flatMap((item) => {
    const range = contentRange(item as AnyNode);
    const value = (item as { value?: unknown }).value;
    return typeof value === "string" ? [{ name: value, implicit: false, range, file }] : [];
  });

  if (stages.length === 0) {
    return null;
  }
  const rank = (stage: Stage): number =>
    stage.name === FIRST_STAGE ? 0 : stage.name === LAST_STAGE ? 2 : 1;
  return stages.toSorted((left, right) => rank(left) - rank(right));
}

function yamlDiagnostics(parsed: ParsedFile): Diagnostic[] {
  return parsed.yaml.errors.map((error) => ({
    code: INVALID_YAML,
    severity: "error" as const,
    params: { detail: error.message },
    range: { start: error.pos[0], end: error.pos[1] },
    file: parsed.file,
  }));
}

function unresolvedDiagnostics(unresolved: readonly UnresolvedInclude[]): Diagnostic[] {
  return unresolved.map((include) => ({
    code: INCLUDE_UNRESOLVED,
    severity: "info" as const,
    params: { form: include.form, detail: include.detail },
    range: include.range,
    file: include.from,
  }));
}

type Collected = {
  definitions: Map<string, Definition[]>;
  /** Last known kind of the key in merge order. A key that is a map in an included file and a
   *  scalar in the main file is not a job: the last definition decides, as for any value. */
  kinds: Map<string, "map" | "opaque">;
  opaque: OpaqueBlock[];
  ranges: Map<string, SourceRange>;
};

function collect(order: readonly ParsedFile[]): Collected {
  const collected: Collected = {
    definitions: new Map(),
    kinds: new Map(),
    opaque: [],
    ranges: new Map(),
  };

  for (const parsed of order) {
    const root = parsed.yaml.contents;
    if (!isMap(root)) {
      continue;
    }

    for (const pair of localPairs(root)) {
      const key = keyOf(pair);
      if (key === null || key === "stages") {
        continue;
      }

      const range = pairRange(pair) ?? emptyRange();
      const value = pair.value as AnyNode;

      if (!isMap(value) || isReservedTopLevel(key)) {
        collected.opaque.push({ key, range, file: parsed.file });
        collected.kinds.set(key, "opaque");
        continue;
      }

      collected.definitions.set(key, [
        ...(collected.definitions.get(key) ?? []),
        { map: value, file: parsed.file },
      ]);
      collected.kinds.set(key, "map");
      collected.ranges.set(key, range);
    }
  }

  return collected;
}

/** A job's opaque blocks, taken from **all** its definitions and not only from the file that owns
 *  it. Without this, a job defined in an include and overridden in the main file lost its
 *  `script` and `artifacts` on screen: they exist in the user's files, the job GitLab renders has
 *  them, and the only surface of the product whose promise is “this is verbatim” displayed “no
 *  opaque block”.
 *
 *  A key defined twice keeps only the last one, because that is the value that wins. Each block
 *  carries its file: its range is an offset into that text. */
function opaqueBlocksOf(definitions: readonly Definition[]): OpaqueBlock[] {
  const blocks = new Map<string, OpaqueBlock>();

  for (const definition of definitions) {
    for (const pair of localPairs(definition.map)) {
      const key = keyOf(pair);
      if (key === null || MODELLED_JOB_KEYS.includes(key as never)) {
        continue;
      }
      const range = pairRange(pair);
      if (range !== null) {
        blocks.set(key, { key, range, file: definition.file });
      }
    }
  }

  return [...blocks.values()];
}

export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const main = options.file ?? GITLAB_CI_FILE;
  const mainFile = parseIncludedFile(main, text);
  const hash = hashText(text);
  const document: GitlabDocument = {
    text,
    hash,
    yaml: mainFile.yaml,
    lineCounter: mainFile.lineCounter,
    file: main,
    read: options.read ?? null,
  };

  const resolution = resolveIncludes(mainFile, options.read ?? null);
  const order: ParsedFile[] = [...resolution.files, mainFile];

  const diagnostics: Diagnostic[] = [
    ...order.flatMap(yamlDiagnostics),
    ...resolution.diagnostics,
    ...unresolvedDiagnostics(resolution.unresolved),
  ];

  const files = order.map((parsed) => parsed.file);
  /** Both families count the same: the displayed pipeline lacks what this include contributed.
   *  Only the first gets an `INCLUDE_UNRESOLVED` — the second already has its error-level
   *  `INCLUDE_NOT_FOUND`, and saying it twice would not say more. */
  const unresolved = [...resolution.unresolved, ...resolution.failed];

  const included: Record<string, string> = {};
  for (const parsed of resolution.files) {
    included[parsed.file] = parsed.text;
  }

  if (!isMap(mainFile.yaml.contents)) {
    return {
      document,
      pipeline: { ...emptyPipeline(main), files, unresolved },
      diagnostics,
      hash,
      included,
    };
  }

  const collected = collect(order);
  const documents = new Map<string, Document.Parsed>(
    order.map((parsed) => [parsed.file, parsed.yaml]),
  );

  const lookup = new Map<string, readonly Definition[]>(
    [...collected.definitions].filter(([key]) => collected.kinds.get(key) === "map"),
  );

  const context: ResolveContext = {
    documents,
    merged: order.map((parsed) => ({ file: parsed.file, document: parsed.yaml })),
    lookup,
    diagnostics,
    /** Downgraded to a warning **only** if an include we could not read may explain the absence:
     *  a remote form, or a `local` without a reader. A broken `local` is not one, its cause is
     *  already a named error. Hence `resolution.unresolved` and not `unresolved`, which also
     *  counts the broken ones because they are missing from the screen (ADR 0007). */
    extendsSeverity: resolution.unresolved.length === 0 ? "error" : "warning",
    main,
    job: "",
  };

  const templates: Template[] = [];
  const jobEntries: { id: string; definitions: readonly Definition[]; range: SourceRange }[] = [];
  const templateMaps = new Map<YAMLMap, string>(
    [...lookup]
      .filter(([key]) => key.startsWith("."))
      .flatMap(([key, definitions]) => definitions.map((definition) => [definition.map, key])),
  );
  const mergesOf = (definitions: readonly Definition[]): { merges?: string[] } => {
    const merges = effectiveMerges(definitions, context, templateMaps);
    return merges.length === 0 ? {} : { merges };
  };

  for (const [key, definitions] of lookup) {
    const range = collected.ranges.get(key) ?? emptyRange();
    // The owner is the **last** contributor in merge order: the one a user would edit, and the
    // only file Keelson will agree to rewrite.
    const owner = definitions[definitions.length - 1]?.file ?? main;

    if (key.startsWith(".")) {
      templates.push({
        id: key,
        range,
        file: owner,
        extends: effectiveExtends(definitions, { ...context, job: key }),
        ...mergesOf(definitions),
      });
    } else {
      jobEntries.push({ id: key, definitions, range });
    }
  }

  const defaults = order.flatMap((parsed): Source[] => {
    const root = parsed.yaml.contents;
    return isMap(root) ? defaultSources(root, parsed.file, context) : [];
  });

  const jobs: Job[] = jobEntries.map((entry) => {
    const owner = entry.definitions[entry.definitions.length - 1];
    const ownerFile = owner?.file ?? main;
    const jobContext: ResolveContext = { ...context, job: entry.id };
    const sources = sourcesFor(entry.definitions, { kind: "local" }, jobContext);
    const stage = resolveStage(sources, jobContext) ?? {
      value: DEFAULT_STAGE,
      origin: { kind: "default" as const },
    };

    const needsBlock = unmodelledNeedsBlock(sources, jobContext);
    const jobOpaque = [
      ...(needsBlock === null ? [] : [needsBlock]),
      ...opaqueBlocksOf(entry.definitions),
    ];

    if (!SCRIPT_KEYS.some((key) => definesKey(sources, key))) {
      diagnostics.push({
        code: JOB_WITHOUT_SCRIPT,
        severity: "warning",
        params: { job: entry.id },
        range: entry.range,
        file: ownerFile,
      });
    }

    return {
      id: entry.id,
      stage,
      needs: resolveNeeds(sources, jobContext),
      ...(hasUnmodelledNeeds(sources) ? { unmodelledNeeds: true as const } : {}),
      environment: resolveEnvironment(sources, jobContext),
      extends: effectiveExtends(entry.definitions, jobContext),
      ...mergesOf(entry.definitions),
      opaque: jobOpaque,
      signals: resolveSignals(sources, defaults, jobContext),
      range: entry.range,
      file: ownerFile,
    };
  });

  const stages =
    order.reduceRight<Stage[] | null>((found, parsed) => {
      if (found !== null) {
        return found;
      }
      const root = parsed.yaml.contents;
      return isMap(root) ? declaredStages(root, parsed.file) : null;
    }, null) ?? defaultStages(main);

  const pipeline: Pipeline = {
    stages,
    jobs,
    templates,
    opaque: collected.opaque.filter((block) => collected.kinds.get(block.key) !== "map"),
    main,
    files,
    unresolved,
  };

  return { document, pipeline, diagnostics, hash, included };
}
