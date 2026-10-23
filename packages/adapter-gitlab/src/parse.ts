import type { Diagnostic, Job, OpaqueBlock, Pipeline, Stage, Template } from "@keelson/core";
import { hashText, INCLUDE_UNRESOLVED, INVALID_YAML, JOB_WITHOUT_SCRIPT } from "@keelson/core";
import { isMap, isSeq, LineCounter, parseDocument, type YAMLMap } from "yaml";
import { DEFAULT_STAGE, DEFAULT_STAGES, isReservedTopLevel } from "./defaults.ts";
import type { GitlabDocument } from "./document.ts";
import {
  type AnyNode,
  contentRange,
  definesKey,
  extendsOf,
  keyOf,
  localPair,
  localPairs,
  MODELLED_JOB_KEYS,
  pairRange,
  REFERENCE_TAG,
  type ResolveContext,
  resolveEnvironment,
  resolveNeeds,
  resolveStage,
  sourcesFor,
} from "./resolve.ts";

export type ParseResult = {
  document: GitlabDocument;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
};

const SCRIPT_KEYS = ["script", "run", "trigger"] as const;

const EMPTY_PIPELINE: Pipeline = { stages: [], jobs: [], templates: [], opaque: [] };

function emptyRange(): { start: number; end: number } {
  return { start: 0, end: 0 };
}

function defaultStages(): Stage[] {
  return DEFAULT_STAGES.map((name) => ({ name, implicit: true, range: null }));
}

function declaredStages(root: YAMLMap): Stage[] | null {
  const pair = localPair(root, "stages");
  if (pair === undefined || !isSeq(pair.value as AnyNode)) {
    return null;
  }

  const seq = pair.value as AnyNode;
  if (!isSeq(seq)) {
    return null;
  }

  const stages = seq.items.flatMap((item) => {
    const range = contentRange(item as AnyNode);
    const value = (item as { value?: unknown }).value;
    return typeof value === "string" ? [{ name: value, implicit: false, range }] : [];
  });

  return stages.length === 0 ? null : stages;
}

export function parse(text: string): ParseResult {
  const lineCounter = new LineCounter();
  const yaml = parseDocument(text, {
    lineCounter,
    keepSourceTokens: true,
    merge: true,
    customTags: [{ tag: REFERENCE_TAG, collection: "seq" }],
  });

  const hash = hashText(text);
  const document: GitlabDocument = { text, hash, yaml, lineCounter };
  const diagnostics: Diagnostic[] = yaml.errors.map((error) => ({
    code: INVALID_YAML,
    severity: "error" as const,
    params: { detail: error.message },
    range: { start: error.pos[0], end: error.pos[1] },
  }));

  const root = yaml.contents;
  if (!isMap(root)) {
    return { document, pipeline: EMPTY_PIPELINE, diagnostics, hash };
  }

  const includePair = localPair(root, "include");
  if (includePair !== undefined) {
    diagnostics.push({
      code: INCLUDE_UNRESOLVED,
      severity: "info",
      params: {},
      range: pairRange(includePair),
    });
  }

  const lookup = new Map<string, YAMLMap>();
  const templates: Template[] = [];
  const jobNodes: { id: string; map: YAMLMap; range: { start: number; end: number } }[] = [];
  const opaque: OpaqueBlock[] = [];

  for (const pair of localPairs(root)) {
    const key = keyOf(pair);
    if (key === null) {
      continue;
    }

    const value = pair.value as AnyNode;
    const range = pairRange(pair) ?? emptyRange();

    if (key === "stages") {
      continue;
    }

    if (!isMap(value) || isReservedTopLevel(key)) {
      opaque.push({ key, range });
      continue;
    }

    lookup.set(key, value);

    if (key.startsWith(".")) {
      templates.push({ id: key, range });
    } else {
      jobNodes.push({ id: key, map: value, range });
    }
  }

  const context: ResolveContext = {
    document: yaml,
    lookup,
    diagnostics,
    extendsSeverity: includePair === undefined ? "error" : "warning",
  };

  const jobs: Job[] = jobNodes.map((entry) => {
    const sources = sourcesFor(entry.map, { kind: "local" }, context);
    const stage = resolveStage(sources, context) ?? {
      value: DEFAULT_STAGE,
      origin: { kind: "default" as const },
    };

    const jobOpaque: OpaqueBlock[] = localPairs(entry.map).flatMap((pair) => {
      const key = keyOf(pair);
      if (key === null || MODELLED_JOB_KEYS.includes(key as never)) {
        return [];
      }
      const range = pairRange(pair);
      return range === null ? [] : [{ key, range }];
    });

    if (!SCRIPT_KEYS.some((key) => definesKey(sources, key))) {
      diagnostics.push({
        code: JOB_WITHOUT_SCRIPT,
        severity: "warning",
        params: { job: entry.id },
        range: entry.range,
      });
    }

    return {
      id: entry.id,
      stage,
      needs: resolveNeeds(sources, context),
      environment: resolveEnvironment(sources, context),
      extends: extendsOf(entry.map),
      opaque: jobOpaque,
      range: entry.range,
    };
  });

  const pipeline: Pipeline = {
    stages: declaredStages(root) ?? defaultStages(),
    jobs,
    templates,
    opaque,
  };

  return { document, pipeline, diagnostics, hash };
}
