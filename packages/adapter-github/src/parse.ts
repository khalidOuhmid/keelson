import type {
  Diagnostic,
  Environment,
  Job,
  JobSignals,
  OpaqueBlock,
  Pipeline,
  SourceRange,
  Stage,
} from "@keelson/core";
import {
  emptyPipeline,
  hashText,
  INVALID_YAML,
  JOB_WITHOUT_SCRIPT,
  WORKFLOW_UNRESOLVED,
} from "@keelson/core";
import { type Document, isMap, isScalar, type Node, type Pair, parseDocument } from "yaml";

export const WORKFLOWS_DIR = ".github/workflows";

export type GithubDocument = {
  text: string;
  hash: string;
  yaml: Document.Parsed;
  file: string;
};

export type ParseResult = {
  document: GithubDocument;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  /** A workflow includes nothing: the shape stays GitLab's, so the caller need not tell them apart. */
  included: Record<string, string>;
};

export type ParseOptions = { file?: string };

/** The `jobs.<id>` keys the IR models: the rest is an opaque block. */
const MODELLED = ["needs", "environment"];

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function pairRange(pair: Pair): SourceRange {
  const key = (pair.key as Node).range ?? [0, 0, 0];
  const value = (pair.value as Node | null)?.range;
  return { start: key[0], end: value?.[1] ?? key[1] };
}

function namesOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function environmentOf(value: unknown): Environment | null {
  if (typeof value === "string") {
    return { name: value };
  }
  if (isRecord(value) && typeof value.name === "string") {
    return typeof value.url === "string"
      ? { name: value.name, url: value.url }
      : { name: value.name };
  }
  return null;
}

function signalsOf(job: Raw): JobSignals {
  const script: string[] = [];
  const actions: string[] = [];
  const container = job.container;
  let image =
    typeof container === "string"
      ? container
      : isRecord(container) && typeof container.image === "string"
        ? container.image
        : null;

  for (const step of Array.isArray(job.steps) ? job.steps : []) {
    if (!isRecord(step)) {
      continue;
    }
    if (typeof step.run === "string") {
      script.push(step.run);
    }
    if (typeof step.uses === "string") {
      // A `docker://` step keeps its place in `actions`: a `container` does not erase its image.
      if (step.uses.startsWith("docker://")) {
        image ??= step.uses.slice("docker://".length);
      }
      actions.push(step.uses);
    }
  }
  return { image, script, ...(actions.length === 0 ? {} : { actions }) };
}

/** A job sits one level above its highest dependency. A cycle stops at its first visit: `validate`
 *  reports it, and the view must still render. */
function levelsOf(needs: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const level = (id: string): number => {
    const known = levels.get(id);
    if (known !== undefined) {
      return known;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    const deepest = Math.max(
      0,
      ...(needs.get(id) ?? []).filter((target) => needs.has(target)).map(level),
    );
    visiting.delete(id);
    levels.set(id, deepest + 1);
    return deepest + 1;
  };
  for (const id of needs.keys()) {
    level(id);
  }
  return levels;
}

export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const file = options.file ?? `${WORKFLOWS_DIR}/workflow.yml`;
  const yaml = parseDocument(text, { keepSourceTokens: false });
  const hash = hashText(text);
  const document: GithubDocument = { text, hash, yaml, file };

  const diagnostics: Diagnostic[] = yaml.errors.map((error) => ({
    code: INVALID_YAML,
    severity: "error",
    params: { detail: error.message },
    range: { start: error.pos[0], end: error.pos[1] },
    file,
  }));

  let raw: unknown = null;
  try {
    raw = yaml.toJS({ mapAsMap: false });
  } catch (error) {
    diagnostics.push({
      code: INVALID_YAML,
      severity: "error",
      params: { detail: error instanceof Error ? error.message : "unreadable YAML" },
      range: null,
      file,
    });
  }

  const root = yaml.contents;
  const pipeline: Pipeline = { ...emptyPipeline(file), files: [file], provider: "github" };
  if (!isMap(root) || !isRecord(raw)) {
    return { document, pipeline, diagnostics, hash, included: {} };
  }

  pipeline.opaque = root.items.flatMap((pair): OpaqueBlock[] =>
    isScalar(pair.key) && pair.key.value !== "jobs"
      ? [{ key: String(pair.key.value), range: pairRange(pair), file }]
      : [],
  );

  const jobsNode = root.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === "jobs",
  )?.value;
  const jobsRaw = isRecord(raw.jobs) ? raw.jobs : {};
  const pairs = isMap(jobsNode) ? jobsNode.items : [];

  const needs = new Map<string, string[]>();
  for (const pair of pairs) {
    const id = String((pair.key as { value?: unknown }).value);
    const job = jobsRaw[id];
    needs.set(id, isRecord(job) ? namesOf(job.needs) : []);
  }
  const levels = levelsOf(needs);

  for (const pair of pairs) {
    const id = String((pair.key as { value?: unknown }).value);
    const job = jobsRaw[id];
    if (!isRecord(job)) {
      continue;
    }

    const range = pairRange(pair);
    const body = pair.value;
    const opaque = (isMap(body) ? body.items : []).flatMap((entry): OpaqueBlock[] => {
      const key = isScalar(entry.key) ? String(entry.key.value) : "";
      return MODELLED.includes(key) ? [] : [{ key, range: pairRange(entry), file }];
    });

    const target = typeof job.uses === "string" ? job.uses : null;
    if (target !== null) {
      diagnostics.push({
        code: WORKFLOW_UNRESOLVED,
        severity: "info",
        params: { job: id, target },
        range,
        file,
      });
      pipeline.unresolved.push({ form: "workflow", detail: target, from: file, range });
    } else if (!Array.isArray(job.steps) || job.steps.length === 0) {
      diagnostics.push({
        code: JOB_WITHOUT_SCRIPT,
        severity: "warning",
        params: { job: id },
        range,
        file,
      });
    }

    const environment = environmentOf(job.environment);
    const entry: Job = {
      id,
      stage: { value: `level ${levels.get(id) ?? 1}`, origin: { kind: "local" } },
      needs:
        job.needs === undefined
          ? null
          : {
              value: (needs.get(id) ?? []).map((name) => ({
                job: name,
                optional: false,
                artifacts: true,
              })),
              origin: { kind: "local" },
            },
      environment: environment === null ? null : { value: environment, origin: { kind: "local" } },
      extends: [],
      opaque,
      signals: signalsOf(job),
      range,
      file,
    };
    pipeline.jobs.push(entry);
  }

  const deepest = Math.max(0, ...levels.values());
  pipeline.stages = Array.from(
    { length: deepest },
    (_, index): Stage => ({
      name: `level ${index + 1}`,
      implicit: false,
      range: null,
      file,
    }),
  );

  return { document, pipeline, diagnostics, hash, included: {} };
}
