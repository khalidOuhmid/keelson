import type { Diagnostic, Environment, Job, OpaqueBlock, Pipeline, Stage } from "@keelson/core";
import { emptyPipeline, hashText, INVALID_YAML, JOB_WITHOUT_SCRIPT } from "@keelson/core";
import { type Document, isMap, isScalar, parseDocument } from "yaml";
import {
  createResolution,
  isRecord,
  pairRange,
  signalsOf,
  type WorkflowReader,
} from "./signals.ts";

export const WORKFLOWS_DIR = ".github/workflows";

export type GithubDocument = {
  text: string;
  hash: string;
  yaml: Document.Parsed;
  file: string;
  /** What it takes to reparse the same pipeline: `apply` re-reads the text, and without the reader
   *  the called workflows' jobs would vanish from the re-read IR. */
  read: WorkflowReader | null;
};

export type ParseResult = {
  document: GithubDocument;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  /** The text of each local reusable workflow and composite action read through the reader. */
  included: Record<string, string>;
};

export type ParseOptions = { file?: string; read?: WorkflowReader | null | undefined };

/** The `jobs.<id>` keys the IR models: the rest is an opaque block. */
const MODELLED = ["needs", "environment"];

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
  const read = options.read ?? null;
  const document: GithubDocument = { text, hash, yaml, file, read };

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
  const resolution = createResolution(read);

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

    const signals = signalsOf(resolution, { id, job, range, file });
    diagnostics.push(...resolution.diagnostics.splice(0));
    pipeline.unresolved.push(...resolution.unresolved.splice(0));
    if (typeof job.uses !== "string" && (!Array.isArray(job.steps) || job.steps.length === 0)) {
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
      signals,
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

  pipeline.files.push(...resolution.included.keys());
  return {
    document,
    pipeline,
    diagnostics,
    hash,
    included: Object.fromEntries(resolution.included),
  };
}
