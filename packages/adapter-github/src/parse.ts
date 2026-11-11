import type {
  Diagnostic,
  Environment,
  Job,
  Need,
  OpaqueBlock,
  Pipeline,
  SourceRange,
  Stage,
  Valued,
} from "@keelson/core";
import { emptyPipeline, hashText, INVALID_YAML, JOB_WITHOUT_SCRIPT } from "@keelson/core";
import { isMap, isPair, isScalar, isSeq, type Pair, parseDocument, type YAMLMap } from "yaml";

export const GITHUB_WORKFLOWS_DIR = ".github/workflows";

const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export function isWorkflowPath(path: string): boolean {
  return WORKFLOW_PATH.test(path);
}

export type ParseOptions = {
  file?: string;
};

export type ParseResult = {
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  included: Record<string, string>;
};

const MODELLED_JOB_KEYS = ["needs", "environment"] as const;

type AnyNode = unknown;

function keyOf(pair: Pair<unknown, unknown>): string | null {
  return isScalar(pair.key) && typeof pair.key.value === "string" ? pair.key.value : null;
}

function pairsOf(map: YAMLMap): Pair<unknown, unknown>[] {
  return map.items.filter((item) => isPair(item));
}

function fieldOf(map: YAMLMap, key: string): AnyNode {
  return pairsOf(map).find((pair) => keyOf(pair) === key)?.value;
}

function pairRange(pair: Pair<unknown, unknown>): SourceRange | null {
  const keyRange = (pair.key as { range?: [number, number, number] } | null)?.range;
  if (keyRange === undefined) {
    return null;
  }
  const valueRange = (pair.value as { range?: [number, number, number] } | null)?.range;
  return { start: keyRange[0], end: valueRange?.[2] ?? keyRange[2] };
}

function stringOf(node: AnyNode): string | null {
  if (!isScalar(node)) {
    return null;
  }
  const value = node.value;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : null;
}

function needsOf(node: AnyNode): Valued<Need[]> | null {
  const single = stringOf(node);
  const names =
    single !== null
      ? [single]
      : isSeq(node)
        ? node.items.flatMap((item) => {
            const name = stringOf(item);
            return name === null ? [] : [name];
          })
        : null;
  if (names === null) {
    return null;
  }
  return {
    value: names.map((job) => ({ job, optional: false, artifacts: false })),
    origin: { kind: "local" },
  };
}

function environmentOf(node: AnyNode): Valued<Environment> | null {
  const short = stringOf(node);
  if (short !== null) {
    return { value: { name: short }, origin: { kind: "local" } };
  }
  if (!isMap(node)) {
    return null;
  }
  const name = stringOf(fieldOf(node, "name"));
  if (name === null) {
    return null;
  }
  const url = stringOf(fieldOf(node, "url"));
  return { value: url === null ? { name } : { name, url }, origin: { kind: "local" } };
}

function actionName(reference: string): string {
  const at = reference.lastIndexOf("@");
  return at > 0 ? reference.slice(0, at) : reference;
}

function imageOf(node: AnyNode): string | null {
  return stringOf(node) ?? (isMap(node) ? stringOf(fieldOf(node, "image")) : null);
}

type Signals = { image: string | null; script: string[]; actions: string[] };

function signalsOf(job: YAMLMap): Signals {
  const script: string[] = [];
  const actions: string[] = [];

  const called = stringOf(fieldOf(job, "uses"));
  if (called !== null) {
    actions.push(actionName(called));
  }

  const steps = fieldOf(job, "steps");
  if (isSeq(steps)) {
    for (const step of steps.items) {
      if (!isMap(step)) {
        continue;
      }
      const uses = stringOf(fieldOf(step, "uses"));
      if (uses !== null) {
        actions.push(actionName(uses));
      }
      const run = stringOf(fieldOf(step, "run"));
      if (run !== null) {
        script.push(...run.split("\n").filter((line) => line.trim() !== ""));
      }
    }
  }

  return { image: imageOf(fieldOf(job, "container")), script, actions };
}

function hasWork(job: YAMLMap): boolean {
  const steps = fieldOf(job, "steps");
  return stringOf(fieldOf(job, "uses")) !== null || (isSeq(steps) && steps.items.length > 0);
}

function opaqueOf(map: YAMLMap, file: string, skipped: readonly string[]): OpaqueBlock[] {
  return pairsOf(map).flatMap((pair) => {
    const key = keyOf(pair);
    const range = pairRange(pair);
    return key === null || range === null || skipped.includes(key) ? [] : [{ key, range, file }];
  });
}

function levelName(level: number): string {
  return `level ${level}`;
}

/** GitHub Actions n'a pas de stages : un job s'ouvre quand ses needs sont finis. La colonne d'un
 *  job est donc la longueur de la plus longue chaîne de needs qui y mène, comme le graphe que
 *  GitHub dessine lui-même. Un cycle ou un need inconnu ne fait pas monter le niveau : la
 *  validation les signale, la mise en page ne doit pas boucler. */
function levelsOf(ids: readonly string[], needs: ReadonlyMap<string, readonly string[]>) {
  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  const levelOf = (id: string): number => {
    const known = levels.get(id);
    if (known !== undefined) {
      return known;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    const parents = (needs.get(id) ?? []).filter((parent) => needs.has(parent));
    const level = 1 + Math.max(0, ...parents.map(levelOf));
    visiting.delete(id);
    levels.set(id, level);
    return level;
  };

  for (const id of ids) {
    levelOf(id);
  }
  return levels;
}

export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const file = options.file ?? `${GITHUB_WORKFLOWS_DIR}/ci.yml`;
  const hash = hashText(text);
  const yaml = parseDocument(text, { keepSourceTokens: true });

  const diagnostics: Diagnostic[] = yaml.errors.map((error) => ({
    code: INVALID_YAML,
    severity: "error" as const,
    params: { detail: error.message },
    range: { start: error.pos[0], end: error.pos[1] },
    file,
  }));

  const root = yaml.contents;
  if (!isMap(root)) {
    return { pipeline: { ...emptyPipeline(file), files: [file] }, diagnostics, hash, included: {} };
  }

  const jobsNode = fieldOf(root, "jobs");
  const entries = isMap(jobsNode)
    ? pairsOf(jobsNode).flatMap((pair) => {
        const id = keyOf(pair);
        const range = pairRange(pair);
        return id !== null && range !== null && isMap(pair.value)
          ? [{ id, range, map: pair.value }]
          : [];
      })
    : [];

  const needs = new Map(
    entries.map((entry) => [
      entry.id,
      (needsOf(fieldOf(entry.map, "needs"))?.value ?? []).map((need) => need.job),
    ]),
  );
  const levels = levelsOf(
    entries.map((entry) => entry.id),
    needs,
  );
  const deepest = Math.max(0, ...levels.values());

  const stages: Stage[] = Array.from({ length: deepest }, (_, index) => ({
    name: levelName(index + 1),
    implicit: true,
    range: null,
    file,
  }));

  const jobs: Job[] = entries.map((entry) => {
    if (!hasWork(entry.map)) {
      diagnostics.push({
        code: JOB_WITHOUT_SCRIPT,
        severity: "warning",
        params: { job: entry.id },
        range: entry.range,
        file,
      });
    }
    return {
      id: entry.id,
      stage: { value: levelName(levels.get(entry.id) ?? 1), origin: { kind: "default" } },
      needs: needsOf(fieldOf(entry.map, "needs")),
      environment: environmentOf(fieldOf(entry.map, "environment")),
      extends: [],
      opaque: opaqueOf(entry.map, file, MODELLED_JOB_KEYS),
      signals: signalsOf(entry.map),
      range: entry.range,
      file,
    };
  });

  return {
    pipeline: {
      stages,
      jobs,
      templates: [],
      opaque: opaqueOf(root, file, ["jobs"]),
      main: file,
      files: [file],
      unresolved: [],
    },
    diagnostics,
    hash,
    included: {},
  };
}
