import type { Diagnostic, JobSignals, SourceRange, UnresolvedInclude } from "@keelson/core";
import { WORKFLOW_CALL_INVALID, WORKFLOW_UNRESOLVED } from "@keelson/core";
import { isMap, isScalar, type Node, type Pair, parseDocument } from "yaml";

/** Structurally the GitLab `IncludeReader`: the server and the CLI hand the same bounded reader to
 *  both adapters, and it alone holds the repository root boundary. */
export type WorkflowReader = { read(path: string): string | null };

/** GitHub connects at most ten levels of workflows, the caller included, and at most 50 unique
 *  reusable workflows from one workflow file, nested ones included:
 *  <https://docs.github.com/en/actions/sharing-automations/reusing-workflows#limitations>. */
const MAX_WORKFLOW_LEVELS = 10;
const MAX_UNIQUE_WORKFLOWS = 50;

/** Composite actions nest too; the same bound keeps a cycle or a pathological chain finite. */
const MAX_ACTION_LEVELS = 10;

/** A matrix line expands to the product of the values it cites, cut here: detection needs each
 *  value once, not every combination of a large matrix. */
const MAX_MATRIX_VARIANTS = 64;

const WORKFLOWS_PREFIX = ".github/workflows/";
const YAML_EXTENSIONS = [".yml", ".yaml"] as const;
const MATRIX_REFERENCE = /\$\{\{\s*matrix\.([A-Za-z_][\w-]*)\s*\}\}/gi;

type Raw = Record<string, unknown>;

export const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function pairRange(pair: Pair): SourceRange {
  const key = (pair.key as Node).range ?? [0, 0, 0];
  const value = (pair.value as Node | null)?.range;
  return { start: key[0], end: value?.[1] ?? key[1] };
}

type Loaded = { values: unknown; jobs: { id: string; range: SourceRange }[] };

type Accumulated = { image: string | null; script: string[]; actions: string[] };

export type Resolution = {
  read: WorkflowReader | null;
  texts: Map<string, string | null>;
  loaded: Map<string, Loaded>;
  merged: Map<string, Accumulated>;
  workflows: Set<string>;
  included: Map<string, string>;
  diagnostics: Diagnostic[];
  unresolved: UnresolvedInclude[];
  seen: Set<string>;
};

export function createResolution(read: WorkflowReader | null): Resolution {
  return {
    read,
    texts: new Map(),
    loaded: new Map(),
    merged: new Map(),
    workflows: new Set(),
    included: new Map(),
    diagnostics: [],
    unresolved: [],
    seen: new Set(),
  };
}

export type JobAt = { id: string; job: Raw; range: SourceRange; file: string };

function report(resolution: Resolution, diagnostic: Diagnostic): void {
  const key = JSON.stringify([
    diagnostic.code,
    diagnostic.file,
    diagnostic.range?.start,
    diagnostic.params,
  ]);
  if (!resolution.seen.has(key)) {
    resolution.seen.add(key);
    resolution.diagnostics.push(diagnostic);
  }
}

function unresolved(resolution: Resolution, entry: UnresolvedInclude): void {
  const key = JSON.stringify(["unresolved", entry.from, entry.range?.start, entry.detail]);
  if (!resolution.seen.has(key)) {
    resolution.seen.add(key);
    resolution.unresolved.push(entry);
  }
}

function readText(resolution: Resolution, path: string): string | null {
  if (!resolution.texts.has(path)) {
    const text = resolution.read?.read(path) ?? null;
    resolution.texts.set(path, text);
    if (text !== null) {
      resolution.included.set(path, text);
    }
  }
  return resolution.texts.get(path) ?? null;
}

function load(resolution: Resolution, path: string, text: string): Loaded {
  const known = resolution.loaded.get(path);
  if (known !== undefined) {
    return known;
  }
  const yaml = parseDocument(text);
  let values: unknown = null;
  try {
    values = yaml.errors.length === 0 ? yaml.toJS({ mapAsMap: false }) : null;
  } catch {
    values = null;
  }
  const root = yaml.contents;
  const jobsNode = isMap(root)
    ? root.items.find((pair) => isScalar(pair.key) && pair.key.value === "jobs")?.value
    : null;
  const jobs = isMap(jobsNode)
    ? jobsNode.items.map((pair) => ({
        id: String((pair.key as { value?: unknown }).value),
        range: pairRange(pair),
      }))
    : [];
  const loaded = { values, jobs };
  resolution.loaded.set(path, loaded);
  return loaded;
}

/** `./a/b` relative to the repository root, or `null` when it leaves it. */
function localPath(target: string): string | null {
  const segments = target
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  return segments.includes("..") ? null : segments.join("/");
}

const isLocal = (target: string): boolean => target.startsWith("./") || target.startsWith("../");

function matrixValues(job: Raw): Map<string, { key: string; values: string[] }> {
  const found = new Map<string, { key: string; values: string[] }>();
  const strategy = job.strategy;
  const matrix = isRecord(strategy) ? strategy.matrix : null;
  if (!isRecord(matrix)) {
    return found;
  }
  const add = (key: string, value: unknown): void => {
    if (!["string", "number", "boolean"].includes(typeof value)) {
      return;
    }
    const entry = found.get(key.toLowerCase()) ?? { key, values: [] };
    found.set(key.toLowerCase(), entry);
    if (!entry.values.includes(String(value))) {
      entry.values.push(String(value));
    }
  };
  for (const [key, value] of Object.entries(matrix)) {
    if (key !== "include" && key !== "exclude" && Array.isArray(value)) {
      for (const item of value) {
        add(key, item);
      }
    }
  }
  for (const item of Array.isArray(matrix.include) ? matrix.include : []) {
    for (const [key, value] of isRecord(item) ? Object.entries(item) : []) {
      add(key, value);
    }
  }
  return found;
}

/** One variant per combination of the matrix values a line cites, in the order the matrix declares
 *  its keys, the last one varying fastest — GitHub's own expansion order. */
function expand(text: string, matrix: ReturnType<typeof matrixValues>): string[] {
  const cited = new Set(
    [...text.matchAll(MATRIX_REFERENCE)].map((match) => match[1]?.toLowerCase()),
  );
  const keys = [...matrix.keys()].filter(
    (key) => cited.has(key) && (matrix.get(key)?.values.length ?? 0) > 0,
  );
  if (keys.length === 0) {
    return [text];
  }
  let combinations: Map<string, string>[] = [new Map()];
  for (const key of keys) {
    const values = matrix.get(key)?.values ?? [];
    combinations = combinations
      .flatMap((combination) => values.map((value) => new Map([...combination, [key, value]])))
      .slice(0, MAX_MATRIX_VARIANTS);
  }
  return combinations.map((combination) =>
    text.replace(
      MATRIX_REFERENCE,
      (whole, key: string) => combination.get(key.toLowerCase()) ?? whole,
    ),
  );
}

function addImage(into: Accumulated, image: string): void {
  const action = `docker://${image}`;
  if (!into.actions.includes(action)) {
    into.actions.push(action);
  }
}

/** The called job's own image is a container among others for the calling job. */
function mergeInto(into: Accumulated, from: Accumulated): void {
  into.script.push(...from.script);
  for (const action of from.actions) {
    if (!into.actions.includes(action)) {
      into.actions.push(action);
    }
  }
  if (from.image !== null) {
    addImage(into, from.image);
  }
}

function actionFile(
  resolution: Resolution,
  directory: string,
): { path: string; text: string } | null {
  for (const extension of YAML_EXTENSIONS) {
    const path = directory === "" ? `action${extension}` : `${directory}/action${extension}`;
    const text = readText(resolution, path);
    if (text !== null) {
      return { path, text };
    }
  }
  return null;
}

function stepsInto(
  resolution: Resolution,
  steps: unknown,
  into: Accumulated,
  matrix: ReturnType<typeof matrixValues>,
  actionTrail: readonly string[],
): void {
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!isRecord(step)) {
      continue;
    }
    if (typeof step.run === "string") {
      into.script.push(...expand(step.run, matrix));
    }
    if (typeof step.uses !== "string") {
      continue;
    }
    // A `docker://` step keeps its place in `actions`: a `container` does not erase its image.
    if (step.uses.startsWith("docker://")) {
      into.image ??= step.uses.slice("docker://".length);
    }
    into.actions.push(step.uses);
    if (isLocal(step.uses)) {
      actionInto(resolution, step.uses, into, actionTrail);
    }
  }
}

/** A local action may come from another checkout, made at run time: a missing one is not an error,
 *  and is reported nowhere. */
function actionInto(
  resolution: Resolution,
  target: string,
  into: Accumulated,
  trail: readonly string[],
): void {
  const directory = localPath(target);
  if (directory === null || resolution.read === null || trail.length >= MAX_ACTION_LEVELS) {
    return;
  }
  const found = actionFile(resolution, directory);
  if (found === null || trail.includes(found.path)) {
    return;
  }
  const { values } = load(resolution, found.path, found.text);
  const runs = isRecord(values) && isRecord(values.runs) ? values.runs : null;
  if (runs === null) {
    return;
  }
  if (runs.using === "composite") {
    stepsInto(resolution, runs.steps, into, new Map(), [...trail, found.path]);
  } else if (typeof runs.image === "string" && runs.image.startsWith("docker://")) {
    addImage(into, runs.image.slice("docker://".length));
  }
}

function invalid(
  resolution: Resolution,
  at: JobAt,
  target: string,
  params: Extract<Diagnostic, { code: typeof WORKFLOW_CALL_INVALID }>["params"],
): void {
  report(resolution, {
    code: WORKFLOW_CALL_INVALID,
    severity: "error",
    params,
    range: at.range,
    file: at.file,
  });
  unresolved(resolution, { form: "workflow", detail: target, from: at.file, range: at.range });
}

/** The jobs of a local reusable workflow, merged into one set of signals: the calling job is one
 *  node, and coverage counts what the called jobs run. */
function workflowInto(
  resolution: Resolution,
  at: JobAt,
  target: string,
  into: Accumulated,
  trail: readonly string[],
): void {
  const path = localPath(target);
  if (path === null) {
    invalid(resolution, at, target, { reason: "outsideRoot", job: at.id, path: target });
    return;
  }
  const inWorkflows =
    path.startsWith(WORKFLOWS_PREFIX) &&
    !path.slice(WORKFLOWS_PREFIX.length).includes("/") &&
    YAML_EXTENSIONS.some((extension) => path.endsWith(extension));
  if (!inWorkflows) {
    invalid(resolution, at, target, { reason: "notInWorkflows", job: at.id, path });
    return;
  }
  if (trail.includes(path)) {
    invalid(resolution, at, target, {
      reason: "cycle",
      job: at.id,
      trail: [...trail.slice(trail.indexOf(path)), path],
    });
    return;
  }
  if (trail.length >= MAX_WORKFLOW_LEVELS) {
    invalid(resolution, at, target, {
      reason: "depth",
      job: at.id,
      path,
      limit: MAX_WORKFLOW_LEVELS,
    });
    return;
  }
  if (!resolution.workflows.has(path) && resolution.workflows.size >= MAX_UNIQUE_WORKFLOWS) {
    invalid(resolution, at, target, {
      reason: "limit",
      job: at.id,
      path,
      limit: MAX_UNIQUE_WORKFLOWS,
    });
    return;
  }
  const text = readText(resolution, path);
  if (text === null) {
    invalid(resolution, at, target, { reason: "missing", job: at.id, path });
    return;
  }
  resolution.workflows.add(path);

  // Keyed by level as well: a cut for depth depends on where the call sits, and the key bounds the
  // work to levels × unique files whatever the fan-out.
  const key = `${trail.length}\u0000${path}`;
  let merged = resolution.merged.get(key);
  if (merged === undefined) {
    merged = { image: null, script: [], actions: [] };
    const { values, jobs } = load(resolution, path, text);
    const raw = isRecord(values) && isRecord(values.jobs) ? values.jobs : {};
    for (const { id, range } of jobs) {
      const job = raw[id];
      if (!isRecord(job)) {
        continue;
      }
      mergeInto(merged, jobInto(resolution, { id, job, range, file: path }, [...trail, path]));
    }
    resolution.merged.set(key, merged);
  }
  mergeInto(into, merged);
}

function jobInto(resolution: Resolution, at: JobAt, trail: readonly string[]): Accumulated {
  const into: Accumulated = { image: null, script: [], actions: [] };
  const { job } = at;
  if (typeof job.uses === "string") {
    const target = job.uses;
    if (isLocal(target) && resolution.read !== null) {
      workflowInto(resolution, at, target, into, trail);
    } else {
      report(resolution, {
        code: WORKFLOW_UNRESOLVED,
        severity: "info",
        params: { job: at.id, target },
        range: at.range,
        file: at.file,
      });
      unresolved(resolution, { form: "workflow", detail: target, from: at.file, range: at.range });
    }
    return into;
  }

  const matrix = matrixValues(job);
  const container = job.container;
  const written =
    typeof container === "string"
      ? container
      : isRecord(container) && typeof container.image === "string"
        ? container.image
        : null;
  const images = written === null ? [] : expand(written, matrix);
  into.image = images[0] ?? null;
  stepsInto(resolution, job.steps, into, matrix, []);
  for (const image of images.slice(1)) {
    addImage(into, image);
  }
  return into;
}

/** What a job runs, as detection needs it: its own steps, the local composite actions they use,
 *  and the jobs of the local reusable workflow it calls, through the reader. */
export function signalsOf(resolution: Resolution, at: JobAt): JobSignals {
  const { image, script, actions } = jobInto(resolution, at, [at.file]);
  return { image, script, ...(actions.length === 0 ? {} : { actions }) };
}
