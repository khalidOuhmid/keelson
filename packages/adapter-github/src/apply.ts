import { applySplices, type Splice } from "@keelson/adapter-gitlab";
import type {
  AddJobOperation,
  AddNeedOperation,
  AddSnippetOperation,
  CompositeOperation,
  Diagnostic,
  Environment,
  Operation,
  OperationError,
  Pipeline,
  RemoveNeedOperation,
  Result,
  SetEnvironmentOperation,
  SourceRange,
  SpliceOperation,
} from "@keelson/core";
import {
  CYCLE,
  err,
  INVALID_NAME,
  INVALID_OPERATION,
  INVALID_YAML,
  JOB_NOT_FOUND,
  JOB_REFERENCED,
  NAME_CONFLICT,
  NEED_EXISTS,
  NEED_NOT_FOUND,
  NEEDS_CYCLE,
  ok,
  parseOperation,
  RANGE_OUT_OF_BOUNDS,
  STALE_DOCUMENT,
  validate,
} from "@keelson/core";
import {
  type Document,
  isAlias,
  isCollection,
  isMap,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  stringify,
  visit,
  type YAMLMap,
} from "yaml";
import { type GithubDocument, parse } from "./parse.ts";

export type ApplyOk = {
  text: string;
  document: GithubDocument;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  inverse: SpliceOperation;
  touched: SourceRange[];
  included: Record<string, string>;
};

/** The action that makes a snippet runnable: it works on the repository. */
const CHECKOUT = "actions/checkout@v4";
const RUNNER = "ubuntu-latest";
const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

type Planned = Result<Splice[], OperationError>;

const refuse = <T>(error: OperationError): Result<T, OperationError> => err(error);

const notFor = (operation: string): Planned =>
  refuse({ code: INVALID_OPERATION, params: { reason: "notForProvider", operation } });

const shared = (job: string, key: string): Planned =>
  refuse({ code: INVALID_OPERATION, params: { reason: "sharedValue", job, key } });

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
  const found = text.indexOf("\n", offset);
  return found === -1 ? text.length : found + 1;
}

function rangeOf(node: unknown): [number, number] {
  const range = (node as Node | null)?.range;
  return range === undefined || range === null ? [0, 0] : [range[0], range[1]];
}

/** Where a node really ends: the `range` of a block collection spills over the next node's comments,
 *  and that of a `|` scalar includes its trailing newline. */
function contentEnd(text: string, node: unknown): number {
  if (isMap(node) && !node.flow) {
    const last = node.items.at(-1);
    return last === undefined ? rangeOf(node)[1] : pairEnd(text, last);
  }
  if (isSeq(node) && !node.flow) {
    const last = node.items.at(-1);
    return last === undefined ? rangeOf(node)[1] : contentEnd(text, last);
  }
  const [start, end] = rangeOf(node);
  if (isScalar(node) && (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED")) {
    return start + text.slice(start, end).trimEnd().length;
  }
  return end;
}

function pairEnd(text: string, pair: Pair): number {
  return Math.max(rangeOf(pair.key)[1], pair.value === null ? 0 : contentEnd(text, pair.value));
}

function pairOf(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => isScalar(pair.key) && String(pair.key.value) === key);
}

function pairSpan(text: string, pair: Pair): Splice {
  return {
    start: lineStart(text, rangeOf(pair.key)[0]),
    end: lineEnd(text, pairEnd(text, pair)),
    text: "",
  };
}

function column(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

function scalar(value: string): string {
  const plain = stringify(value, { lineWidth: 0 }).replace(/\r?\n$/, "");
  const document = parseDocument(`key: ${plain}\n`);
  return !plain.includes("\n") && document.errors.length === 0 && document.get("key") === value
    ? plain
    : JSON.stringify(value);
}

type Geometry = {
  text: string;
  eol: string;
  root: YAMLMap | null;
  pipeline: Pipeline;
  /** The document as values: expressions are searched for here, not in the text. */
  values: unknown;
};

const jobsPair = (geometry: Geometry): Pair | undefined =>
  geometry.root === null ? undefined : pairOf(geometry.root, "jobs");

function jobsMap(geometry: Geometry): YAMLMap | null {
  const value = jobsPair(geometry)?.value;
  return isMap(value) ? value : null;
}

function jobLines(
  id: string,
  body: readonly string[],
  needs: readonly string[],
  environment: Environment | undefined,
): string[] {
  return [
    `${scalar(id)}:`,
    `  runs-on: ${RUNNER}`,
    ...(needs.length === 0 ? [] : [`  needs: [${needs.map(scalar).join(", ")}]`]),
    ...(environment === undefined ? [] : environmentLines(environment).map((line) => `  ${line}`)),
    "  steps:",
    ...body.map((line) => `    ${line}`),
  ];
}

function environmentLines(environment: Environment): string[] {
  return environment.url === undefined
    ? [`environment: ${scalar(environment.name)}`]
    : ["environment:", `  name: ${scalar(environment.name)}`, `  url: ${scalar(environment.url)}`];
}

function indented(lines: readonly string[], indent: number, eol: string): string {
  return lines.map((line) => `${" ".repeat(indent)}${line}${eol}`).join("");
}

function insertJob(lines: readonly string[], geometry: Geometry): Planned {
  const { text, eol } = geometry;
  const pair = jobsPair(geometry);
  const glue = text.length === 0 || text.endsWith("\n") ? "" : eol;

  if (pair === undefined) {
    return ok([
      {
        start: text.length,
        end: text.length,
        text: `${glue}jobs:${eol}${indented(lines, 2, eol)}`,
      },
    ]);
  }

  const value = pair.value as Node | null;
  if (value === null || (isScalar(value) && value.value === null)) {
    const at = lineEnd(text, rangeOf(pair.key)[1]);
    return ok([{ start: at, end: at, text: `${glue}${indented(lines, 2, eol)}` }]);
  }
  if (!isMap(value) || value.flow === true) {
    return refuse({ code: INVALID_OPERATION, params: { reason: "flowStyleJob", job: "jobs" } });
  }

  const first = value.items[0];
  const indent = first === undefined ? 2 : column(text, rangeOf(first.key)[0]);
  const at = lineEnd(text, contentEnd(text, value));
  const tail = at === text.length && !text.endsWith("\n") ? eol : "";
  return ok([{ start: at, end: at, text: `${tail}${indented(lines, indent, eol)}` }]);
}

function nameRefusal(id: string, geometry: Geometry): OperationError | null {
  if (!JOB_ID.test(id)) {
    return { code: INVALID_NAME, params: { reason: "job", name: id } };
  }
  return geometry.pipeline.jobs.some((job) => job.id === id)
    ? { code: NAME_CONFLICT, params: { name: id } }
    : null;
}

function planAddJob(operation: AddJobOperation, geometry: Geometry): Planned {
  const { job } = operation;
  const refused = nameRefusal(job.id, geometry);
  if (refused !== null) {
    return refuse(refused);
  }
  if (job.script.length === 0) {
    return refuse({ code: INVALID_OPERATION, params: { reason: "jobWithoutScript" } });
  }
  if (job.environment?.action !== undefined) {
    return notFor("setEnvironment");
  }
  if (job.needs?.some((need) => need.optional === true || need.artifacts === false)) {
    return notFor("addJob");
  }
  const steps = job.script.map((line) => `- run: ${scalar(line)}`);
  const environment =
    job.environment === undefined
      ? undefined
      : {
          name: job.environment.name,
          ...(job.environment.url === undefined ? {} : { url: job.environment.url }),
        };
  return insertJob(
    jobLines(
      job.id,
      steps,
      (job.needs ?? []).map((need) => need.job),
      environment,
    ),
    geometry,
  );
}

/** A block list of steps, with no anchor or alias: copied elsewhere, an alias would lose its target. */
function snippetSteps(snippet: string): string[] | null {
  const document = parseDocument(snippet);
  const root = document.contents;
  if (document.errors.length > 0 || !isSeq(root) || root.flow === true || root.items.length === 0) {
    return null;
  }
  const preamble = snippet.slice(0, rangeOf(root)[0]);
  if (/^[ \t]+\S/m.test(preamble) || !root.items.every((item) => isMap(item))) {
    return null;
  }
  let sharing = false;
  visit(document, {
    Alias() {
      sharing = true;
    },
    Node(_key, node) {
      if ((node as { anchor?: string }).anchor !== undefined) {
        sharing = true;
      }
    },
  });
  return sharing
    ? null
    : snippet
        .trimEnd()
        .split(/\r?\n/)
        .filter((line) => !/^\.\.\.\s*$/.test(line));
}

function planAddSnippet(operation: AddSnippetOperation, geometry: Geometry): Planned {
  const refused = nameRefusal(operation.id, geometry);
  if (refused !== null) {
    return refuse(refused);
  }
  const steps = snippetSteps(operation.snippet);
  if (steps === null) {
    return refuse({ code: INVALID_OPERATION, params: { reason: "invalidSnippet" } });
  }
  return insertJob(
    jobLines(operation.id, [`- uses: ${CHECKOUT}`, ...steps], [], undefined),
    geometry,
  );
}

function jobTarget(id: string, geometry: Geometry): Result<YAMLMap, OperationError> {
  const map = jobsMap(geometry);
  const pair = map === null ? undefined : pairOf(map, id);
  if (pair === undefined) {
    return refuse({ code: JOB_NOT_FOUND, params: { job: id } });
  }
  const value = pair.value as Node | null;
  if (isAlias(value)) {
    return refuse({
      code: INVALID_OPERATION,
      params: { reason: "sharedValue", job: id, key: "job" },
    });
  }
  if (!isMap(value) || value.flow === true) {
    return refuse({ code: INVALID_OPERATION, params: { reason: "flowStyleJob", job: id } });
  }
  if (value.anchor !== undefined) {
    return refuse({
      code: INVALID_OPERATION,
      params: { reason: "sharedValue", job: id, key: "job" },
    });
  }
  return ok(value);
}

function referencing(id: string, geometry: Geometry): string[] {
  return geometry.pipeline.jobs
    .filter((job) => job.needs?.value.some((need) => need.job === id))
    .map((job) => job.id);
}

/** The inside of each `${{ }}`. A `}}` inside a `'…'` string closes nothing. */
function expressionsOf(value: string, found: string[]): void {
  let start = value.indexOf("${{");
  while (start !== -1) {
    let inString = false;
    let index = start + 3;
    while (index < value.length && (inString || !value.startsWith("}}", index))) {
      if (value[index] === "'") {
        inString = !inString;
      }
      index += 1;
    }
    found.push(value.slice(start + 3, index));
    start = value.indexOf("${{", index);
  }
}

/** The expressions of a document: in values, in keys, and every `if` key. */
function expressionsIn(value: unknown, found: string[], seen: Set<unknown>, key = ""): void {
  if (typeof value === "string") {
    if (key === "if") {
      found.push(value);
    }
    expressionsOf(value, found);
  } else if (typeof value === "object" && value !== null && !seen.has(value)) {
    seen.add(value);
    for (const [name, entry] of Object.entries(value)) {
      expressionsOf(name, found);
      expressionsIn(entry, found, seen, name);
    }
  }
}

/** The content of each `'…'` string replaced with `_`: a `'needs-review'` label reads no context,
 *  and a literal index `needs['z']` keeps its shape. `''` is the escaped apostrophe. */
function withoutLiterals(expression: string): string {
  return expression.replace(/'(?:[^']|'')*'/g, "'_'");
}

const dynamicRoot = (context: "needs" | "jobs"): RegExp =>
  new RegExp(
    `(?<![\\w.-])${context}\\b(?!\\s*\\.\\s*[\\w*-]+|\\s*\\[\\s*['"][\\w-]+['"]\\s*\\])`,
    "i",
  );
const DYNAMIC_NEEDS = dynamicRoot("needs");
const DYNAMIC_JOBS = dynamicRoot("jobs");

function expressionsOfValue(value: unknown): string[] {
  const found: string[] = [];
  expressionsIn(value, found, new Set());
  return found.map(withoutLiterals);
}

function needsOf(job: unknown): string[] {
  const needs = (job as { needs?: unknown } | null)?.needs;
  return typeof needs === "string" ? [needs] : Array.isArray(needs) ? needs.map(String) : [];
}

/** A job's `needs` context holds only its own needs: read whole or through a computed index, it can
 *  only reach those. */
const readsNeedsOf = (job: unknown, id: string): boolean =>
  needsOf(job).includes(id) && expressionsOfValue(job).some((value) => DYNAMIC_NEEDS.test(value));

/** `needs.<id>` and `jobs.<id>` in an expression, in dot or bracket form: the name lives there too,
 *  and cannot be rewritten without understanding that language. A context read whole or through a
 *  computed index can reach the job without naming it: `needs` in a job that has `id` as a need,
 *  `jobs` (outputs of a reusable workflow) anywhere. Only the root of the context counts, not
 *  `env.NEEDS` nor a label. Refusing beats an `if:` that silently turns false. A document that cannot
 *  be read as values is refused for the same reason. `scope` says whether `values` is the document or
 *  a single job. */
function citation(
  values: unknown,
  id: string,
  scope: "document" | "job",
): "named" | "dynamic" | null {
  if (values === null) {
    return "named";
  }
  const name = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(
    `(?<![\\w.-])(?:needs|jobs)\\s*(?:\\.\\s*${name}(?![\\w-])|\\[\\s*['"]${name}['"]\\s*\\])`,
    "i",
  );
  const raw: string[] = [];
  expressionsIn(values, raw, new Set());
  if (raw.some((value) => named.test(value))) {
    return "named";
  }
  if (scope === "job") {
    return readsNeedsOf(values, id) ? "dynamic" : null;
  }
  if (expressionsOfValue(values).some((value) => DYNAMIC_JOBS.test(value))) {
    return "dynamic";
  }
  const jobs = (values as { jobs?: unknown }).jobs;
  const entries = typeof jobs === "object" && jobs !== null ? Object.values(jobs) : [];
  return entries.some((job) => readsNeedsOf(job, id)) ? "dynamic" : null;
}

function citesJob(
  values: unknown,
  id: string,
  scope: "document" | "job" = "document",
): Planned | null {
  const found = citation(values, id, scope);
  return found === null
    ? null
    : refuse({
        code: INVALID_OPERATION,
        params: { reason: found === "named" ? "citedInExpression" : "dynamicExpression", job: id },
      });
}

function readValues(document: Document.Parsed): unknown {
  try {
    return document.toJS({ mapAsMap: false });
  } catch {
    return null;
  }
}

function planRemoveJob(id: string, geometry: Geometry): Planned {
  const located = jobTarget(id, geometry);
  if (!located.ok) {
    return located;
  }
  const refused = citesJob(geometry.values, id);
  if (refused !== null) {
    return refused;
  }
  const referencedBy = referencing(id, geometry);
  if (referencedBy.length > 0) {
    return refuse({ code: JOB_REFERENCED, params: { job: id, referencedBy } });
  }
  const pair = pairOf(jobsMap(geometry) as YAMLMap, id) as Pair;
  return ok([pairSpan(geometry.text, pair)]);
}

/** The scalars naming `id` in `needs`, all at the same level: scalar or list. */
function needScalars(job: YAMLMap, id: string): Node[] {
  const value = pairOf(job, "needs")?.value as Node | null | undefined;
  const items: unknown[] = isSeq(value) ? value.items : value === undefined ? [] : [value];
  return items.filter((item): item is Node => isScalar(item) && item.value === id);
}

function planRename(from: string, to: string, geometry: Geometry): Planned {
  const located = jobTarget(from, geometry);
  if (!located.ok) {
    return located;
  }
  const refused = nameRefusal(to, geometry);
  if (refused !== null) {
    return refuse(refused);
  }
  const cited = citesJob(geometry.values, from);
  if (cited !== null) {
    return cited;
  }
  const map = jobsMap(geometry) as YAMLMap;
  const key = (pairOf(map, from) as Pair).key;
  const references = map.items.flatMap((pair) =>
    isMap(pair.value) ? needScalars(pair.value, from) : [],
  );
  return ok(
    [key, ...references].map((node) => {
      const [start, end] = rangeOf(node);
      return { start, end, text: scalar(to) };
    }),
  );
}

function planAddNeed(operation: AddNeedOperation, geometry: Geometry): Planned {
  const located = jobTarget(operation.id, geometry);
  if (!located.ok) {
    return located;
  }
  const { job, optional, artifacts } = operation.need;
  if (optional === true || artifacts === false) {
    return notFor("addNeed");
  }
  const current = geometry.pipeline.jobs.find((entry) => entry.id === operation.id);
  if (current?.needs?.value.some((need) => need.job === job)) {
    return refuse({ code: NEED_EXISTS, params: { job: operation.id, need: job } });
  }

  const { text, eol } = geometry;
  const map = located.value;
  const pair = pairOf(map, "needs");
  if (pair === undefined) {
    const first = map.items[0];
    if (first === undefined) {
      return shared(operation.id, "needs");
    }
    const at = lineStart(text, rangeOf(first.key)[0]);
    const indent = column(text, rangeOf(first.key)[0]);
    return ok([{ start: at, end: at, text: indented([`needs: ${scalar(job)}`], indent, eol) }]);
  }

  const value = pair.value as Node | null;
  if (isScalar(value) && typeof value.value === "string") {
    const [start, end] = rangeOf(value);
    return ok([{ start, end, text: `[${scalar(value.value)}, ${scalar(job)}]` }]);
  }
  if (!isSeq(value) || value.anchor !== undefined) {
    return shared(operation.id, "needs");
  }
  if (value.flow === true) {
    const last = value.items.at(-1);
    if (last === undefined) {
      const [start, end] = rangeOf(value);
      return ok([{ start, end, text: `[${scalar(job)}]` }]);
    }
    const end = rangeOf(last)[1];
    return ok([{ start: end, end, text: `, ${scalar(job)}` }]);
  }

  const last = value.items.at(-1);
  if (last === undefined) {
    return shared(operation.id, "needs");
  }
  const start = rangeOf(last)[0];
  const prefix = text.slice(lineStart(text, start), start).replace(/[&!][^\s]*[ \t]+/g, "");
  if (!prefix.includes("-")) {
    return shared(operation.id, "needs");
  }
  const at = lineEnd(text, contentEnd(text, last));
  const tail = at === text.length && !text.endsWith("\n") ? eol : "";
  return ok([{ start: at, end: at, text: `${tail}${prefix}${scalar(job)}${eol}` }]);
}

function planRemoveNeed(operation: RemoveNeedOperation, geometry: Geometry): Planned {
  const located = jobTarget(operation.id, geometry);
  if (!located.ok) {
    return located;
  }
  const current = geometry.pipeline.jobs.find((entry) => entry.id === operation.id);
  const names = current?.needs?.value.map((need) => need.job) ?? [];
  if (!names.includes(operation.job)) {
    return refuse({
      code: NEED_NOT_FOUND,
      params: { reason: "notNeeded", job: operation.id, need: operation.job },
    });
  }

  const { text } = geometry;
  const values = (geometry.values as { jobs?: Record<string, unknown> } | null)?.jobs;
  const refused = citesJob(
    values?.[operation.id] ?? (values === undefined ? null : {}),
    operation.job,
    "job",
  );
  if (refused !== null) {
    return refused;
  }
  const pair = pairOf(located.value, "needs") as Pair;
  const value = pair.value as Node | null;
  const remaining = names.filter((name) => name !== operation.job);
  if (remaining.length === 0) {
    return ok([pairSpan(text, pair)]);
  }
  if (!isSeq(value) || value.anchor !== undefined) {
    return shared(operation.id, "needs");
  }
  if (value.flow === true) {
    const [start, end] = rangeOf(value);
    return ok([{ start, end, text: `[${remaining.map(scalar).join(", ")}]` }]);
  }
  const item = value.items.find((entry) => isScalar(entry) && entry.value === operation.job);
  if (item === undefined) {
    return shared(operation.id, "needs");
  }
  return ok([
    {
      start: lineStart(text, rangeOf(item)[0]),
      end: lineEnd(text, contentEnd(text, item)),
      text: "",
    },
  ]);
}

function planSetEnvironment(operation: SetEnvironmentOperation, geometry: Geometry): Planned {
  const located = jobTarget(operation.id, geometry);
  if (!located.ok) {
    return located;
  }
  const { environment } = operation;
  if (environment?.action !== undefined || pairOf(located.value, "uses") !== undefined) {
    return notFor("setEnvironment");
  }

  const { text, eol } = geometry;
  const map = located.value;
  const pair = pairOf(map, "environment");
  if (environment === null) {
    return pair === undefined ? ok([]) : ok([pairSpan(text, pair)]);
  }

  const lines = environmentLines({
    name: environment.name,
    ...(environment.url === undefined ? {} : { url: environment.url }),
  });
  const first = map.items[0];
  if (first === undefined) {
    return shared(operation.id, "environment");
  }
  const indent = column(text, rangeOf(first.key)[0]);
  if (pair !== undefined) {
    return ok([{ ...pairSpan(text, pair), text: indented(lines, indent, eol) }]);
  }
  const at = lineEnd(text, contentEnd(text, map));
  const tail = at === text.length && !text.endsWith("\n") ? eol : "";
  return ok([{ start: at, end: at, text: `${tail}${indented(lines, indent, eol)}` }]);
}

function planFor(operation: Exclude<Operation, CompositeOperation>, geometry: Geometry): Planned {
  switch (operation.kind) {
    case "addJob":
      return planAddJob(operation, geometry);
    case "addSnippet":
      return planAddSnippet(operation, geometry);
    case "removeJob":
      return planRemoveJob(operation.id, geometry);
    case "renameJob":
      return planRename(operation.from, operation.to, geometry);
    case "addNeed":
      return planAddNeed(operation, geometry);
    case "removeNeed":
      return planRemoveNeed(operation, geometry);
    case "setEnvironment":
      return planSetEnvironment(operation, geometry);
    case "addStage":
    case "moveStage":
    case "setJobStage":
      return notFor(operation.kind);
    case "splice":
      return operation.start > operation.end || operation.end > geometry.text.length
        ? refuse({
            code: RANGE_OUT_OF_BOUNDS,
            params: {
              reason: "textRange",
              start: operation.start,
              end: operation.end,
              length: geometry.text.length,
            },
          })
        : ok([{ start: operation.start, end: operation.end, text: operation.text }]);
  }
}

type Model = { id: string; needs: string[]; environment: unknown }[];

function modelOf(pipeline: Pipeline): Model {
  return pipeline.jobs
    .map((job) => ({
      id: job.id,
      needs: (job.needs?.value ?? []).map((need) => need.job).sort(),
      environment: job.environment?.value ?? null,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));
}

/** What the operation must produce, computed without the text. The patch does not know every
 *  hand-written shape: a re-read that differs becomes a refusal, never a wrong write. */
function expectedModel(
  pipeline: Pipeline,
  operation: Exclude<Operation, CompositeOperation | SpliceOperation>,
): Model | null {
  const before = modelOf(pipeline);
  const update = (id: string, change: (entry: Model[number]) => Model[number]): Model =>
    before.map((entry) => (entry.id === id ? change(entry) : entry));

  switch (operation.kind) {
    case "addJob": {
      const { id, needs, environment } = operation.job;
      return [
        ...before,
        {
          id,
          needs: (needs ?? []).map((need) => need.job).sort(),
          environment: environment ?? null,
        },
      ];
    }
    case "addSnippet":
      return [...before, { id: operation.id, needs: [], environment: null }];
    case "removeJob":
      return before.filter((entry) => entry.id !== operation.id);
    case "renameJob":
      return before.map((entry) => ({
        ...entry,
        id: entry.id === operation.from ? operation.to : entry.id,
        needs: entry.needs.map((need) => (need === operation.from ? operation.to : need)).sort(),
      }));
    case "addNeed":
      return update(operation.id, (entry) => ({
        ...entry,
        needs: [...entry.needs, operation.need.job].sort(),
      }));
    case "removeNeed":
      return update(operation.id, (entry) => ({
        ...entry,
        needs: entry.needs.filter((need) => need !== operation.job),
      }));
    case "setEnvironment":
      return update(operation.id, (entry) => ({ ...entry, environment: operation.environment }));
    default:
      return null;
  }
}

const sorted = (model: Model): string =>
  JSON.stringify([...model].sort((left, right) => (left.id < right.id ? -1 : 1)));

/** A cyclic anchor cannot be serialised: it cannot be compared, so it is refused. */
function sameValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

const stripped = (job: unknown): unknown => {
  if (typeof job !== "object" || job === null) {
    return job;
  }
  const { needs: _needs, environment: _environment, ...rest } = job as Record<string, unknown>;
  return rest;
};

/** Everything the operation does not target must read back identically: the file-level keys and, for
 *  each job, everything that is neither `needs` nor `environment`. This is what catches a shortened
 *  `|+` block, or an alias that changes target. */
function neighboursIntact(
  before: Document.Parsed,
  text: string,
  operation: Exclude<Operation, CompositeOperation | SpliceOperation>,
): boolean {
  // An empty file is a document with no keys: adding a job changes nothing else in it.
  const left = (readValues(before) ?? {}) as Record<string, unknown>;
  const right = (readValues(parseDocument(text)) ?? {}) as Record<string, unknown>;

  const renamed = operation.kind === "renameJob" ? operation : null;
  const removed = operation.kind === "removeJob" ? operation.id : null;
  const { jobs: leftJobs, ...leftRoot } = left;
  const { jobs: rightJobs, ...rightRoot } = right;
  if (!sameValue(leftRoot, rightRoot)) {
    return false;
  }
  const after = (rightJobs ?? {}) as Record<string, unknown>;
  return Object.entries((leftJobs ?? {}) as Record<string, unknown>).every(([id, job]) => {
    if (id === removed) {
      return true;
    }
    const target = renamed !== null && id === renamed.from ? renamed.to : id;
    return sameValue(stripped(job), stripped(after[target]));
  });
}

function danglingAliases(text: string): number {
  const anchors = new Set<string>();
  let count = 0;
  visit(parseDocument(text), {
    Alias(_key, node) {
      if (!anchors.has(node.source)) {
        count += 1;
      }
    },
    Node(_key, node) {
      const { anchor } = node as { anchor?: string };
      if (anchor !== undefined) {
        anchors.add(anchor);
      }
    },
  });
  return count;
}

/** Every re-read goes through here: without the reader, the re-read IR would lose the jobs of the
 *  local workflows it calls. */
function reparse(document: GithubDocument, text: string) {
  return parse(text, { file: document.file, read: document.read });
}

function finish(
  document: GithubDocument,
  text: string,
  touched: SourceRange[],
  inverse: { start: number; end: number; text: string },
): Result<ApplyOk, OperationError> {
  const after = reparse(document, text);
  return ok({
    text,
    document: after.document,
    pipeline: after.pipeline,
    diagnostics: after.diagnostics,
    hash: after.hash,
    inverse: { v: 1, baseHash: after.hash, kind: "splice", ...inverse },
    touched,
    included: after.included,
  });
}

function applyComposite(
  document: GithubDocument,
  operation: CompositeOperation,
): Result<ApplyOk, OperationError> {
  let current = document;
  for (const step of operation.steps) {
    const result = apply(current, { v: 1, baseHash: current.hash, ...step });
    if (!result.ok) {
      return result;
    }
    current = result.value.document;
  }

  const before = document.text;
  const after = current.text;
  let prefix = 0;
  while (prefix < before.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const end = after.length - suffix;
  return finish(document, after, [{ start: prefix, end }], {
    start: prefix,
    end,
    text: before.slice(prefix, before.length - suffix),
  });
}

export function apply(
  document: GithubDocument,
  operation: Operation,
): Result<ApplyOk, OperationError> {
  const validated = parseOperation(operation);
  if (!validated.ok) {
    return validated;
  }
  const op = validated.value;
  if (op.baseHash !== document.hash) {
    return err({
      code: STALE_DOCUMENT,
      params: { expected: document.hash, received: op.baseHash },
    });
  }
  if (op.kind === "composite") {
    return applyComposite(document, op);
  }

  const { text } = document;
  const before = reparse(document, text);
  const root = document.yaml.contents;
  if (root !== null && !isMap(root) && op.kind !== "splice") {
    return err({ code: INVALID_OPERATION, params: { reason: "noRootMap" } });
  }
  if (isCollection(root) && root.flow === true && op.kind !== "splice") {
    return err({ code: INVALID_OPERATION, params: { reason: "flowStyleJob", job: "jobs" } });
  }

  const geometry: Geometry = {
    text,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    root: isMap(root) ? root : null,
    pipeline: before.pipeline,
    values: readValues(document.yaml),
  };
  const planned = planFor(op, geometry);
  if (!planned.ok) {
    return planned;
  }

  const spliced = applySplices(text, planned.value);
  if (op.kind !== "splice") {
    const after = reparse(document, spliced.text);
    const broke =
      after.diagnostics.some((entry) => entry.code === INVALID_YAML) &&
      !before.diagnostics.some((entry) => entry.code === INVALID_YAML);
    const expected = expectedModel(before.pipeline, op);
    const faithful = expected === null || sorted(modelOf(after.pipeline)) === sorted(expected);
    const intact = neighboursIntact(document.yaml, spliced.text, op);
    if (broke || !faithful || !intact || danglingAliases(spliced.text) > danglingAliases(text)) {
      return err({
        code: INVALID_OPERATION,
        params: { reason: "wouldBreakYaml", operation: op.kind },
      });
    }
    const cycles = (pipeline: Pipeline): number =>
      validate(pipeline).filter((entry) => entry.code === NEEDS_CYCLE).length;
    if (cycles(after.pipeline) > cycles(before.pipeline)) {
      return err({ code: CYCLE, params: { operation: op.kind } });
    }
  }

  const ordered = [...planned.value].sort((left, right) => left.start - right.start);
  const first = ordered[0];
  const last = ordered.at(-1);
  const firstTouched = spliced.touched[0];
  const lastTouched = spliced.touched.at(-1);
  return finish(
    document,
    spliced.text,
    spliced.touched,
    first === undefined ||
      last === undefined ||
      firstTouched === undefined ||
      lastTouched === undefined
      ? { start: 0, end: 0, text: "" }
      : {
          start: firstTouched.start,
          end: lastTouched.end,
          text: text.slice(first.start, last.end),
        },
  );
}
