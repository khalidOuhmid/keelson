import type {
  AddJobOperation,
  AddNeedOperation,
  AddSnippetOperation,
  AddStageOperation,
  CompositeOperation,
  MoveStageOperation,
  Need,
  Operation,
  OperationError,
  OperationErrorCode,
  ParamsOf,
  Pipeline,
  RemoveJobOperation,
  RemoveNeedOperation,
  RenameJobOperation,
  Result,
  SetEnvironmentOperation,
  SetJobStageOperation,
  SourceRange,
  SpliceOperation,
} from "@keelson/core";
import {
  CYCLE,
  err,
  FROM_INCLUDED_FILE,
  INVALID_NAME,
  INVALID_OPERATION,
  INVALID_YAML,
  isLegalJobName,
  JOB_NOT_FOUND,
  JOB_REFERENCED,
  NAME_CONFLICT,
  NEED_EXISTS,
  NEED_NOT_FOUND,
  NEEDS_CYCLE,
  ok,
  parseOperation,
  RANGE_OUT_OF_BOUNDS,
  STAGE_EXISTS,
  STAGE_NOT_FOUND,
  STALE_DOCUMENT,
  validate,
} from "@keelson/core";
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  stringify,
  visit,
  YAMLMap,
  type YAMLSeq,
} from "yaml";
import { DEFAULT_STAGES, FIRST_STAGE, LAST_STAGE } from "./defaults.ts";
import type { GitlabDocument } from "./document.ts";
import { applySplices, type Splice } from "./emit.ts";
import { parse } from "./parse.ts";
import {
  type AnyNode,
  keyOf,
  localPair,
  localPairs,
  MERGE_KEY,
  pairRange,
  REFERENCE_TAG,
} from "./resolve.ts";
import type { ApplyError, ApplyOk } from "./result.ts";
import {
  afterLine,
  blankRunAfter,
  blankRunBefore,
  eolOf,
  indentUnit,
  linePrefix,
  lineStart,
} from "./text.ts";

type Plan = Splice[];

type Planned = Result<Plan, ApplyError>;

type Geometry = {
  text: string;
  eol: string;
  indent: string;
  /** The pipeline another text of the same file would give, includes resolved the same way. */
  reparse: (text: string) => Pipeline;
};

type Target = {
  pair: Pair<unknown, unknown>;
  map: YAMLMap;
};

type EnvironmentInput = {
  name: string;
  url?: string | undefined;
  action?: string | undefined;
};

function fail<C extends OperationErrorCode>(code: C, params: ParamsOf<C>) {
  return err<ApplyError>({ code, params } as OperationError);
}

function nodeRange(node: AnyNode): [number, number, number] | undefined {
  return (node as { range?: [number, number, number] } | null | undefined)?.range;
}

function pairLineRange(text: string, pair: Pair<unknown, unknown>): SourceRange | null {
  const range = pairRange(pair);
  const keyStart = nodeRange(pair.key as AnyNode)?.[0];
  return range === null || keyStart === undefined
    ? null
    : { start: lineStart(text, keyStart), end: range.end };
}

function valueContent(node: AnyNode): SourceRange | null {
  const range = nodeRange(node);
  return range === undefined ? null : { start: range[0], end: range[1] };
}

function topLevelMap(document: GitlabDocument): YAMLMap | null {
  const root = document.yaml.contents;
  return isMap(root) ? root : null;
}

/** The file of an element, when it is **not** the main file. Keelson never writes anywhere but
 *  the main file: that is the guarantee everything else rests on — the ranges, the atomic write,
 *  the server's allowlist. */
function foreignFile(pipeline: Pipeline, file: string): string | null {
  return file === pipeline.main ? null : file;
}

/** The `stages` list comes from a single file: a list overrides and does not merge. An implicit
 *  stage carries the main file, so a missing list can still be materialised. */
function foreignStagesFile(pipeline: Pipeline): string | null {
  for (const stage of pipeline.stages) {
    const foreign = foreignFile(pipeline, stage.file);
    if (foreign !== null) {
      return foreign;
    }
  }
  return null;
}

/** Is the name already taken in an included file? `addJob` and `renameJob` only looked at the
 *  main file, where the name is free: the write would have produced a **partial override**, a job
 *  that silently inherits the include's keys. */
function takenByInclude(pipeline: Pipeline, name: string): string | null {
  const owner =
    pipeline.jobs.find((job) => job.id === name) ??
    pipeline.templates.find((template) => template.id === name);
  return owner === undefined ? null : foreignFile(pipeline, owner.file);
}

function jobTarget(root: YAMLMap, id: string, pipeline: Pipeline): Result<Target, ApplyError> {
  const found = pipeline.jobs.find((job) => job.id === id);
  if (found === undefined) {
    return fail(JOB_NOT_FOUND, { job: id });
  }

  const foreign = foreignFile(pipeline, found.file);
  if (foreign !== null) {
    return fail(FROM_INCLUDED_FILE, { reason: "job", job: id, file: foreign });
  }

  const pair = localPair(root, id);
  const map = pair?.value as AnyNode;
  if (pair === undefined || !isMap(map)) {
    return fail(JOB_NOT_FOUND, { job: id });
  }

  if (root.flow === true) {
    return fail(INVALID_OPERATION, { reason: "flowStyleJob", job: id });
  }

  return ok({ pair, map });
}

function isFlowJob(target: Target): boolean {
  return target.map.flow === true;
}

/** A pair of a flow map, from its key to the end of its value, separators excluded. */
function flowPairSpan(pair: Pair<unknown, unknown>): SourceRange | null {
  const key = nodeRange(pair.key as AnyNode);
  if (key === undefined) {
    return null;
  }
  return { start: key[0], end: nodeRange(pair.value as AnyNode)?.[1] ?? key[1] };
}

/** A new entry goes last in a flow map: after every merge key, where Psych lets it win. */
function flowInsertion(target: Target, entry: string): Splice | null {
  const last = localPairs(target.map).at(-1);
  if (last === undefined) {
    const open = nodeRange(target.map)?.[0];
    return open === undefined ? null : { start: open + 1, end: open + 1, text: entry };
  }
  const end = flowPairSpan(last)?.end;
  return end === undefined ? null : { start: end, end, text: `, ${entry}` };
}

/** Removes a pair of a flow map with one of its separators. A comment between two entries stays:
 *  only the separator is taken with the pair then. */
function flowRemoval(text: string, target: Target, pair: Pair<unknown, unknown>): Splice | null {
  const pairs = localPairs(target.map);
  const position = pairs.indexOf(pair);
  const span = flowPairSpan(pair);
  if (span === null || position === -1) {
    return null;
  }
  const next = pairs[position + 1];
  const nextStart = next === undefined ? undefined : flowPairSpan(next)?.start;
  if (nextStart !== undefined) {
    const gap = text.slice(span.end, nextStart);
    if (!gap.includes("#")) {
      return { start: span.start, end: nextStart, text: "" };
    }
    const comma = gap.indexOf(",");
    const spaces = /^[ \t]*/.exec(gap.slice(comma + 1))?.[0].length ?? 0;
    return comma === -1
      ? null
      : { start: span.start, end: span.end + comma + 1 + spaces, text: "" };
  }
  const previous = pairs[position - 1];
  const previousEnd = previous === undefined ? undefined : flowPairSpan(previous)?.end;
  if (previousEnd !== undefined && !text.slice(previousEnd, span.start).includes("#")) {
    return { start: previousEnd, end: span.end, text: "" };
  }
  const ownLine = lineStart(text, span.start);
  if (previousEnd !== undefined && linePrefix(text, span.start).trim() === "" && ownLine > 0) {
    const eol = text[ownLine - 2] === "\r" ? 2 : 1;
    return { start: ownLine - eol, end: span.end, text: "" };
  }
  return { ...span, text: "" };
}

function flowEntry(
  splice: Splice | null,
  reason: "needsKey" | "environmentKey" | "stageKey",
): Planned {
  return splice === null ? fail(RANGE_OUT_OF_BOUNDS, { reason }) : ok([splice]);
}

function renderFlowNeeds(needs: readonly Need[]): string {
  return `needs: [${needs.map(renderFlowNeed).join(", ")}]`;
}

function renderFlowEnvironment(environment: EnvironmentInput): string {
  if (environment.url === undefined && environment.action === undefined) {
    return `environment: ${scalarText(environment.name)}`;
  }
  const fields = [
    `name: ${scalarText(environment.name)}`,
    ...(environment.url === undefined ? [] : [`url: ${scalarText(environment.url)}`]),
    ...(environment.action === undefined ? [] : [`action: ${scalarText(environment.action)}`]),
  ];
  return `environment: { ${fields.join(", ")} }`;
}

/** After the job's key, and after its last merge key: Psych lets a later write win, so an
 *  override written above a `<<` would be overwritten by the merged map. */
function overrideInsertAt(geometry: Geometry, target: Target): number {
  const lastMerge = localPairs(target.map).findLast((pair) => keyOf(pair) === MERGE_KEY);
  const mergeEnd = lastMerge === undefined ? undefined : nodeRange(lastMerge.value as AnyNode)?.[1];
  if (mergeEnd !== undefined) {
    return afterLine(geometry.text, mergeEnd);
  }
  const range = nodeRange(target.pair.key as AnyNode);
  return afterLine(geometry.text, range?.[0] ?? 0);
}

function renderNeedItem(need: Need, prefix: string, eol: string): string {
  if (!need.optional && need.artifacts) {
    return `${prefix}${need.job}${eol}`;
  }

  const continuation = " ".repeat(prefix.length);
  const lines = [`${prefix}job: ${need.job}`];
  if (need.optional) {
    lines.push(`${continuation}optional: true`);
  }
  if (!need.artifacts) {
    lines.push(`${continuation}artifacts: false`);
  }
  return lines.map((line) => `${line}${eol}`).join("");
}

function renderFlowNeed(need: Need): string {
  if (!need.optional && need.artifacts) {
    return need.job;
  }
  const options = [
    ...(need.optional ? ["optional: true"] : []),
    ...(need.artifacts ? [] : ["artifacts: false"]),
  ];
  return `{ job: ${need.job}, ${options.join(", ")} }`;
}

/** An anchored node is shared: every alias of it would change with it. */
function anchored(node: AnyNode): boolean {
  return (node as { anchor?: string } | null | undefined)?.anchor !== undefined;
}

function renderNeedsBlock(needs: readonly Need[], geometry: Geometry, pad: string): string {
  const { eol, indent } = geometry;
  const itemPrefix = `${pad}${indent}- `;
  const items = needs.map((need) => renderNeedItem(need, itemPrefix, eol)).join("");
  return `${pad}needs:${eol}${items}`;
}

function renderEnvironmentBlock(
  environment: EnvironmentInput,
  geometry: Geometry,
  pad: string,
): string {
  const { eol, indent } = geometry;
  if (environment.url === undefined && environment.action === undefined) {
    return `${pad}environment: ${environment.name}${eol}`;
  }

  const inner = `${pad}${indent}`;
  const lines = [`${inner}name: ${environment.name}`];
  if (environment.url !== undefined) {
    lines.push(`${inner}url: ${environment.url}`);
  }
  if (environment.action !== undefined) {
    lines.push(`${inner}action: ${environment.action}`);
  }
  return `${pad}environment:${eol}${lines.map((line) => `${line}${eol}`).join("")}`;
}

function effectiveNeeds(pipeline: Pipeline, id: string): Need[] {
  return [...(pipeline.jobs.find((job) => job.id === id)?.needs?.value ?? [])];
}

function seqItems(node: AnyNode): Node[] {
  return isSeq(node) ? (node.items as Node[]) : [];
}

function planAddJob(
  operation: AddJobOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const { job } = operation;

  if (!isLegalJobName(job.id)) {
    return fail(INVALID_NAME, { reason: "job", name: job.id });
  }
  if (localPair(root, job.id) !== undefined) {
    return fail(NAME_CONFLICT, { name: job.id });
  }
  const takenAdd = takenByInclude(pipeline, job.id);
  if (takenAdd !== null) {
    return fail(FROM_INCLUDED_FILE, { reason: "nameTaken", name: job.id, file: takenAdd });
  }
  if (!pipeline.stages.some((stage) => stage.name === job.stage)) {
    return fail(STAGE_NOT_FOUND, { stage: job.stage });
  }
  if (job.script.length === 0) {
    return fail(INVALID_OPERATION, { reason: "jobWithoutScript" });
  }

  const { text, eol, indent } = geometry;
  const needsFinalEol = text.length > 0 && !text.endsWith(eol);
  const needs = (job.needs ?? []).map((need) => ({
    job: need.job,
    optional: need.optional ?? false,
    artifacts: need.artifacts ?? true,
  }));

  const body = [
    `${job.id}:${eol}`,
    `${indent}stage: ${scalarText(job.stage)}${eol}`,
    needs.length === 0 ? "" : renderNeedsBlock(needs, geometry, indent),
    job.environment === undefined ? "" : renderEnvironmentBlock(job.environment, geometry, indent),
    `${indent}script:${eol}`,
    job.script.map((line) => `${indent}${indent}- ${line}${eol}`).join(""),
  ].join("");

  return ok([
    {
      start: text.length,
      end: text.length,
      text: `${needsFinalEol ? eol : ""}${eol}${body}`,
    },
  ]);
}

function planRemoveJob(
  operation: RemoveJobOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const located = jobTarget(root, operation.id, pipeline);
  if (!located.ok) {
    return located;
  }

  const referencedBy = pipeline.jobs
    .filter(
      (job) =>
        job.id !== operation.id &&
        (job.needs?.value ?? []).some((need) => need.job === operation.id),
    )
    .map((job) => job.id);

  if (referencedBy.length > 0) {
    return fail(JOB_REFERENCED, { job: operation.id, referencedBy });
  }

  const range = pairRange(located.value.pair);
  if (range === null) {
    return fail(RANGE_OUT_OF_BOUNDS, { reason: "jobRange", job: operation.id });
  }

  const { text, eol } = geometry;
  const swallowed = blankRunAfter(text, range.end, eol);
  const start =
    swallowed === range.end && swallowed >= text.length
      ? blankRunBefore(text, range.start, eol)
      : range.start;

  return ok([{ start, end: swallowed, text: "" }]);
}

function needReferenceSplices(root: YAMLMap, from: string, to: string): Splice[] {
  const splices: Splice[] = [];

  for (const pair of localPairs(root)) {
    const owner = pair.value as AnyNode;
    if (!isMap(owner)) {
      continue;
    }
    const needs = localPair(owner, "needs")?.value as AnyNode;
    for (const item of seqItems(needs)) {
      if (!isMap(item)) {
        const range = valueContent(item);
        if (range !== null && (item as { value?: unknown }).value === from) {
          splices.push({ ...range, text: to });
        }
        continue;
      }
      const jobValue = localPair(item, "job")?.value as AnyNode;
      const range = valueContent(jobValue);
      if (range !== null && (jobValue as { value?: unknown })?.value === from) {
        splices.push({ ...range, text: to });
      }
    }
  }

  return splices;
}

function planRenameJob(operation: RenameJobOperation, root: YAMLMap, pipeline: Pipeline): Planned {
  const located = jobTarget(root, operation.from, pipeline);
  if (!located.ok) {
    return located;
  }
  if (!isLegalJobName(operation.to)) {
    return fail(INVALID_NAME, { reason: "job", name: operation.to });
  }
  if (localPair(root, operation.to) !== undefined) {
    return fail(NAME_CONFLICT, { name: operation.to });
  }
  const takenRename = takenByInclude(pipeline, operation.to);
  if (takenRename !== null) {
    return fail(FROM_INCLUDED_FILE, { reason: "nameTaken", name: operation.to, file: takenRename });
  }

  // `needReferenceSplices` only rewrites the main file. A job in an included file that needs the
  // old name would therefore keep a broken `needs`, and the rename would produce an UNKNOWN_NEED
  // that the user could not fix from Keelson.
  const referencedByInclude = pipeline.jobs
    .filter(
      (job) =>
        foreignFile(pipeline, job.file) !== null &&
        (job.needs?.value ?? []).some((need) => need.job === operation.from),
    )
    .map((job) => ({ job: job.id, file: job.file }));

  if (referencedByInclude.length > 0) {
    return fail(FROM_INCLUDED_FILE, {
      reason: "referencedByInclude",
      job: operation.from,
      referencedBy: referencedByInclude,
    });
  }

  const keyRange = valueContent(located.value.pair.key as AnyNode);
  if (keyRange === null) {
    return fail(RANGE_OUT_OF_BOUNDS, { reason: "jobRange", job: operation.from });
  }

  return ok([
    { ...keyRange, text: operation.to },
    ...needReferenceSplices(root, operation.from, operation.to),
  ]);
}

function planSetJobStage(
  operation: SetJobStageOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const located = jobTarget(root, operation.id, pipeline);
  if (!located.ok) {
    return located;
  }
  if (!pipeline.stages.some((stage) => stage.name === operation.stage)) {
    return fail(STAGE_NOT_FOUND, { stage: operation.stage });
  }

  const local = localPair(located.value.map, "stage");
  if (local !== undefined) {
    const range = valueContent(local.value as AnyNode);
    if (range === null) {
      return fail(RANGE_OUT_OF_BOUNDS, { reason: "stageKey" });
    }
    // The range of a `!reference` starts after its tag: replacing the value alone would write
    // `stage: !reference test`. The key is therefore rewritten with it, and the override is explicit.
    // The end of a block sequence takes its line break and the comments that follow with it:
    // so we stop at the end of its last item.
    const value = local.value as AnyNode;
    const tagged = (value as { tag?: string }).tag === REFERENCE_TAG;
    const keyStart = nodeRange(local.key as AnyNode)?.[0];
    const end =
      isSeq(value) && value.flow !== true ? nodeRange(seqItems(value).at(-1))?.[1] : range.end;
    if (!tagged || keyStart === undefined || end === undefined) {
      return ok([{ ...range, text: scalarText(operation.stage) }]);
    }

    // An anchor, a comment or an explicit key live in the rewritten range: losing them silently
    // would write a wrong file, so we refuse.
    const lines = geometry.text.slice(keyStart, end).split(/\r?\n/);
    const anchored = (value as { anchor?: string }).anchor !== undefined;
    const commented = lines.slice(0, -1).some((line) => /\s#/.test(line));
    const explicitKey = linePrefix(geometry.text, keyStart).trim() === "?";
    if (anchored || commented || explicitKey) {
      return fail(INVALID_OPERATION, { reason: "sharedValue", job: operation.id, key: "stage" });
    }
    return ok([{ start: keyStart, end, text: `stage: ${scalarText(operation.stage)}` }]);
  }

  if (isFlowJob(located.value)) {
    return flowEntry(
      flowInsertion(located.value, `stage: ${scalarText(operation.stage)}`),
      "stageKey",
    );
  }
  const at = overrideInsertAt(geometry, located.value);
  return ok([
    {
      start: at,
      end: at,
      text: `${geometry.indent}stage: ${scalarText(operation.stage)}${geometry.eol}`,
    },
  ]);
}

/** The start of an item's line, without its anchor or tag: copying them onto a new item would
 *  move the anchor, and every alias would silently change value. */
function itemPrefix(text: string, offset: number): string {
  const here = linePrefix(text, offset).replace(/[&!][^\s]*[ \t]+/g, "");
  if (here.includes("-")) {
    return here;
  }
  // An item can start on the previous line: `- # note` then its value.
  const lines = text.slice(0, lineStart(text, offset)).split("\n");
  const dash = lines.toReversed().find((line) => /^\s*-(\s|$)/.test(line));
  return dash === undefined ? here : `${/^\s*/.exec(dash)?.[0] ?? ""}- `;
}

function rewritesUnmodelled(pipeline: Pipeline, id: string): boolean {
  return pipeline.jobs.find((job) => job.id === id)?.unmodelledNeeds === true;
}

/** The IR does not carry these items: rewriting the list would silently lose them. */
function unmodelledRefusal(job: string): Planned {
  return fail(INVALID_OPERATION, { reason: "sharedValue", job, key: "needs" });
}

function planAddNeed(
  operation: AddNeedOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const located = jobTarget(root, operation.id, pipeline);
  if (!located.ok) {
    return located;
  }

  const current = effectiveNeeds(pipeline, operation.id);
  if (current.some((need) => need.job === operation.need.job)) {
    return fail(NEED_EXISTS, { job: operation.id, need: operation.need.job });
  }

  const added: Need = {
    job: operation.need.job,
    optional: operation.need.optional ?? false,
    artifacts: operation.need.artifacts ?? true,
  };

  const { text, eol } = geometry;
  const local = localPair(located.value.map, "needs");

  if (local === undefined) {
    if (rewritesUnmodelled(pipeline, operation.id)) {
      return unmodelledRefusal(operation.id);
    }
    if (isFlowJob(located.value)) {
      return flowEntry(
        flowInsertion(located.value, renderFlowNeeds([...current, added])),
        "needsKey",
      );
    }
    const at = overrideInsertAt(geometry, located.value);
    return ok([
      {
        start: at,
        end: at,
        text: renderNeedsBlock([...current, added], geometry, geometry.indent),
      },
    ]);
  }

  const seq = local.value as AnyNode;
  // A shared list is not extended in place: the replacement would lose its items, an item added
  // to a `!reference` would be a wrong path, and one added to an anchored list would reach every
  // alias of it. Keelson does not rewrite what it shares.
  if (isAlias(seq) || anchored(seq) || (seq as { tag?: string }).tag === REFERENCE_TAG) {
    return fail(INVALID_OPERATION, { reason: "sharedValue", job: operation.id, key: "needs" });
  }

  const items = seqItems(seq);
  const last = items.at(-1);

  if (isSeq(seq) && seq.flow === true) {
    if (last === undefined) {
      const range = valueContent(seq);
      return range === null
        ? fail(RANGE_OUT_OF_BOUNDS, { reason: "needsKey" })
        : ok([{ ...range, text: `[${renderFlowNeed(added)}]` }]);
    }
    const end = nodeRange(last)?.[1];
    return end === undefined
      ? fail(RANGE_OUT_OF_BOUNDS, { reason: "lastNeed" })
      : ok([{ start: end, end, text: `, ${renderFlowNeed(added)}` }]);
  }

  if (last === undefined) {
    if (isFlowJob(located.value)) {
      const span = flowPairSpan(local);
      return flowEntry(span && { ...span, text: renderFlowNeeds([added]) }, "needsKey");
    }
    const range = pairLineRange(text, local);
    return range === null
      ? fail(RANGE_OUT_OF_BOUNDS, { reason: "needsKey" })
      : ok([
          {
            ...range,
            text: renderNeedsBlock(
              [added],
              geometry,
              linePrefix(text, nodeRange(local.key as AnyNode)?.[0] ?? 0),
            ),
          },
        ]);
  }

  const lastRange = nodeRange(last);
  if (lastRange === undefined) {
    return fail(RANGE_OUT_OF_BOUNDS, { reason: "lastNeed" });
  }
  const prefix = itemPrefix(text, lastRange[0]);
  const atEnd = lastRange[2] === text.length && !text.endsWith("\n");
  return ok([
    {
      start: lastRange[2],
      end: lastRange[2],
      text: `${atEnd ? eol : ""}${renderNeedItem(added, prefix, eol)}`,
    },
  ]);
}

function planRemoveNeed(
  operation: RemoveNeedOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const located = jobTarget(root, operation.id, pipeline);
  if (!located.ok) {
    return located;
  }

  const current = effectiveNeeds(pipeline, operation.id);
  if (!current.some((need) => need.job === operation.job)) {
    return fail(NEED_NOT_FOUND, { reason: "notNeeded", job: operation.id, need: operation.job });
  }

  const remaining = current.filter((need) => need.job !== operation.job);
  const local = localPair(located.value.map, "needs");

  if (
    (local === undefined || remaining.length === 0) &&
    rewritesUnmodelled(pipeline, operation.id)
  ) {
    return unmodelledRefusal(operation.id);
  }

  if (local !== undefined && anchored(local.value as AnyNode)) {
    return fail(INVALID_OPERATION, { reason: "sharedValue", job: operation.id, key: "needs" });
  }

  if (local === undefined) {
    if (isFlowJob(located.value)) {
      return flowEntry(flowInsertion(located.value, renderFlowNeeds(remaining)), "needsKey");
    }
    const at = overrideInsertAt(geometry, located.value);
    return ok([
      {
        start: at,
        end: at,
        text:
          remaining.length === 0
            ? `${geometry.indent}needs: []${geometry.eol}`
            : renderNeedsBlock(remaining, geometry, geometry.indent),
      },
    ]);
  }

  if (remaining.length === 0) {
    if (seqItems(local.value as AnyNode).some(anchored)) {
      return fail(INVALID_OPERATION, { reason: "sharedValue", job: operation.id, key: "needs" });
    }
    if (isFlowJob(located.value)) {
      return flowEntry(flowRemoval(geometry.text, located.value, local), "needsKey");
    }
    const range = pairLineRange(geometry.text, local);
    return range === null
      ? fail(RANGE_OUT_OF_BOUNDS, { reason: "needsKey" })
      : ok([{ ...range, text: "" }]);
  }

  const seq = local.value as AnyNode;
  const items = seqItems(seq);
  const index = items.findIndex((item) => {
    if (isMap(item)) {
      const jobValue = localPair(item, "job")?.value as AnyNode;
      return (jobValue as { value?: unknown })?.value === operation.job;
    }
    return (item as { value?: unknown }).value === operation.job;
  });

  const victim = items[index];
  const victimRange = victim === undefined ? undefined : nodeRange(victim);
  if (victimRange === undefined) {
    return fail(NEED_NOT_FOUND, { reason: "notLocal", job: operation.id, need: operation.job });
  }
  if (anchored(victim)) {
    return fail(INVALID_OPERATION, { reason: "sharedValue", job: operation.id, key: "needs" });
  }

  if (isSeq(seq) && seq.flow === true) {
    const next = items[index + 1];
    const nextStart = next === undefined ? undefined : nodeRange(next)?.[0];
    if (nextStart !== undefined) {
      return ok([{ start: victimRange[0], end: nextStart, text: "" }]);
    }
    const previous = items[index - 1];
    const previousEnd = previous === undefined ? undefined : nodeRange(previous)?.[1];
    return ok([{ start: previousEnd ?? victimRange[0], end: victimRange[1], text: "" }]);
  }

  return ok([{ start: lineStart(geometry.text, victimRange[0]), end: victimRange[2], text: "" }]);
}

function planSetEnvironment(
  operation: SetEnvironmentOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const located = jobTarget(root, operation.id, pipeline);
  if (!located.ok) {
    return located;
  }

  const local = localPair(located.value.map, "environment");
  const inherited = pipeline.jobs.find((job) => job.id === operation.id)?.environment ?? null;

  const flow = isFlowJob(located.value);
  if (operation.environment === null) {
    const cancel = (pad: string) => `${pad}environment: null${geometry.eol}`;
    if (local !== undefined && flow) {
      const removal = flowRemoval(geometry.text, located.value, local);
      const span = flowPairSpan(local);
      if (removal === null || span === null) {
        return fail(RANGE_OUT_OF_BOUNDS, { reason: "environmentKey" });
      }
      const removed = applySplices(geometry.text, [removal]).text;
      const resurfaces =
        geometry.reparse(removed).jobs.find((job) => job.id === operation.id)?.environment !== null;
      return ok([resurfaces ? { ...span, text: "environment: null" } : removal]);
    }
    if (local !== undefined) {
      const range = pairLineRange(geometry.text, local);
      const keyStart = nodeRange(local.key as AnyNode)?.[0];
      if (range === null || keyStart === undefined) {
        return fail(RANGE_OUT_OF_BOUNDS, { reason: "environmentKey" });
      }
      const removed = applySplices(geometry.text, [{ ...range, text: "" }]).text;
      const resurfaces =
        geometry.reparse(removed).jobs.find((job) => job.id === operation.id)?.environment !== null;
      return ok([
        { ...range, text: resurfaces ? cancel(linePrefix(geometry.text, keyStart)) : "" },
      ]);
    }
    if (inherited !== null) {
      // GitLab: “to exclude a key from the extended content, assign it to null”.
      if (flow) {
        return flowEntry(flowInsertion(located.value, "environment: null"), "environmentKey");
      }
      const at = overrideInsertAt(geometry, located.value);
      return ok([{ start: at, end: at, text: cancel(geometry.indent) }]);
    }
    return ok([]);
  }

  const environment = operation.environment;

  if (flow) {
    const span = local === undefined ? null : flowPairSpan(local);
    const entry = renderFlowEnvironment(environment);
    return flowEntry(
      local === undefined ? flowInsertion(located.value, entry) : span && { ...span, text: entry },
      "environmentKey",
    );
  }

  if (local !== undefined) {
    const range = pairLineRange(geometry.text, local);
    const keyStart = nodeRange(local.key as AnyNode)?.[0];
    if (range === null || keyStart === undefined) {
      return fail(RANGE_OUT_OF_BOUNDS, { reason: "environmentKey" });
    }
    const pad = linePrefix(geometry.text, keyStart);
    return ok([{ ...range, text: renderEnvironmentBlock(environment, geometry, pad) }]);
  }

  const at = overrideInsertAt(geometry, located.value);
  return ok([
    { start: at, end: at, text: renderEnvironmentBlock(environment, geometry, geometry.indent) },
  ]);
}

function stagesSeq(root: YAMLMap): { pair: Pair<unknown, unknown>; seq: YAMLSeq } | null {
  const pair = localPair(root, "stages");
  const value = pair?.value as AnyNode;
  return pair !== undefined && isSeq(value) ? { pair, seq: value } : null;
}

function materialiseStages(names: readonly string[], geometry: Geometry, root: YAMLMap): Splice {
  const { eol, indent } = geometry;
  const body = names.map((name) => `${indent}- ${scalarText(name)}${eol}`).join("");
  const first = localPairs(root)[0];
  const at = nodeRange(first?.key as AnyNode)?.[0] ?? 0;
  return { start: at, end: at, text: `stages:${eol}${body}${eol}` };
}

/** Where a stage other than `.pre` and `.post` can stand: GitLab pins those two at the ends. */
function movableBounds(names: readonly string[]): { low: number; high: number } {
  return {
    low: names[0] === FIRST_STAGE ? 1 : 0,
    high: names.at(-1) === LAST_STAGE ? names.length - 1 : names.length,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** The list item a displayed stage was read from. The display order is not the list's order once
 *  `.pre` or `.post` is written elsewhere than at its end: the item is found by its range. */
function stageItem(items: readonly Node[], pipeline: Pipeline, name: string): Node | undefined {
  const start = pipeline.stages.find((stage) => stage.name === name)?.range?.start;
  return start === undefined ? undefined : items.find((item) => nodeRange(item)?.[0] === start);
}

/** Inserts `text` in a stage list next to displayed neighbours: before `next`'s item, otherwise
 *  after `previous`'s. A block item takes its own line; the comments around it stay where they
 *  are. */
function stageInsertion(
  declared: { seq: YAMLSeq },
  pipeline: Pipeline,
  neighbours: { previous: string | undefined; next: string | undefined },
  value: string,
  geometry: Geometry,
  ownPrefix?: string,
): Splice | null {
  const { text, eol } = geometry;
  const items = declared.seq.items as Node[];
  const next =
    neighbours.next === undefined ? undefined : stageItem(items, pipeline, neighbours.next);
  const previous =
    neighbours.previous === undefined ? undefined : stageItem(items, pipeline, neighbours.previous);
  // `.post` can be written anywhere in the list: next to it says nothing of the displayed order.
  const pinned = neighbours.next === LAST_STAGE && previous !== undefined;
  const nextRange = next === undefined || pinned ? undefined : nodeRange(next);
  const previousRange = previous === undefined ? undefined : nodeRange(previous);

  if (declared.seq.flow === true) {
    if (nextRange !== undefined) {
      return { start: nextRange[0], end: nextRange[0], text: `${value}, ` };
    }
    return previousRange === undefined
      ? null
      : { start: previousRange[1], end: previousRange[1], text: `, ${value}` };
  }

  if (nextRange !== undefined) {
    const at = lineStart(text, nextRange[0]);
    return {
      start: at,
      end: at,
      text: `${ownPrefix ?? itemPrefix(text, nextRange[0])}${value}${eol}`,
    };
  }
  if (previousRange === undefined) {
    return null;
  }
  const at = afterLine(text, previousRange[1]);
  const glue = at === text.length && !text.endsWith("\n") ? eol : "";
  return {
    start: at,
    end: at,
    text: `${glue}${ownPrefix ?? itemPrefix(text, previousRange[0])}${value}${eol}`,
  };
}

function planAddStage(
  operation: AddStageOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  if (operation.name === "") {
    return fail(INVALID_NAME, { reason: "stage" });
  }
  if (pipeline.stages.some((stage) => stage.name === operation.name)) {
    return fail(STAGE_EXISTS, { stage: operation.name });
  }

  // Without this refusal, `stagesSeq(root)` finds nothing in the main file and the rest
  // **materialises** a default stage list: the include's list would be overwritten by
  // `.pre, build, test, deploy, .post` without anything saying so.
  const foreignStagesAdd = foreignStagesFile(pipeline);
  if (foreignStagesAdd !== null) {
    return fail(FROM_INCLUDED_FILE, { reason: "stages", file: foreignStagesAdd });
  }

  const names = pipeline.stages.map((stage) => stage.name);
  if ((operation.index ?? 0) > names.length) {
    return fail(RANGE_OUT_OF_BOUNDS, {
      reason: "stageIndex",
      index: operation.index ?? 0,
      count: names.length,
    });
  }
  const { low, high } = movableBounds(names);
  const index = clamp(operation.index ?? high, low, high);

  const declared = stagesSeq(root);
  if (declared === null) {
    const materialised: string[] = [...DEFAULT_STAGES];
    materialised.splice(index, 0, operation.name);
    return ok([materialiseStages(materialised, geometry, root)]);
  }

  const splice = stageInsertion(
    declared,
    pipeline,
    { previous: names[index - 1], next: names[index] },
    scalarText(operation.name),
    geometry,
  );
  return splice === null ? fail(RANGE_OUT_OF_BOUNDS, { reason: "emptyStageList" }) : ok([splice]);
}

function planMoveStage(
  operation: MoveStageOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const names = pipeline.stages.map((stage) => stage.name);
  if (!names.includes(operation.name)) {
    return fail(STAGE_NOT_FOUND, { stage: operation.name });
  }

  const foreignStagesMove = foreignStagesFile(pipeline);
  if (foreignStagesMove !== null) {
    return fail(FROM_INCLUDED_FILE, { reason: "stages", file: foreignStagesMove });
  }
  if (operation.toIndex >= names.length) {
    return fail(RANGE_OUT_OF_BOUNDS, {
      reason: "stageIndex",
      index: operation.toIndex,
      count: names.length,
    });
  }
  if (operation.name === FIRST_STAGE || operation.name === LAST_STAGE) {
    return ok([]);
  }

  const rest = names.filter((name) => name !== operation.name);
  const { low, high } = movableBounds(rest);
  const to = clamp(operation.toIndex, low, high);
  const reordered = [...rest];
  reordered.splice(to, 0, operation.name);

  if (reordered.every((name, position) => name === names[position])) {
    return ok([]);
  }

  const declared = stagesSeq(root);
  if (declared === null) {
    return ok([materialiseStages(reordered, geometry, root)]);
  }

  const items = declared.seq.items as Node[];
  const victim = stageItem(items, pipeline, operation.name);
  const victimRange = victim === undefined ? undefined : nodeRange(victim);
  if (victim === undefined || victimRange === undefined) {
    return fail(RANGE_OUT_OF_BOUNDS, { reason: "stageList" });
  }

  const { text } = geometry;
  // The item is moved as written: its quotes and anchor go with it.
  const written = text.slice(victimRange[0], victimRange[1]);
  const ownPrefix = linePrefix(text, victimRange[0]);
  const position = items.indexOf(victim);
  let removal: Splice[];
  if (declared.seq.flow === true) {
    removal = flowItemRemoval(
      text,
      victimRange,
      nodeRange(items[position - 1])?.[1],
      nodeRange(items[position + 1])?.[0],
    );
  } else {
    removal = [
      {
        start: lineStart(text, victimRange[0]),
        end: afterLine(text, victimRange[1]),
        text: "",
      },
    ];
  }

  const insertion = stageInsertion(
    declared,
    pipeline,
    { previous: reordered[to - 1], next: reordered[to + 1] },
    written,
    geometry,
    ownPrefix.includes("-") ? ownPrefix : undefined,
  );
  if (insertion === null) {
    return fail(RANGE_OUT_OF_BOUNDS, { reason: "emptyStageList" });
  }
  return ok([...removal, insertion]);
}

/** The comma separating two flow items, skipping the comments in the gap between them. */
function flowComma(text: string, from: number, to: number): number | null {
  for (let at = from; at < to; at += 1) {
    if (text[at] === "#") {
      const end = text.indexOf("\n", at);
      at = end === -1 || end > to ? to : end;
    } else if (text[at] === ",") {
      return at;
    }
  }
  return null;
}

/** A flow item goes with the comma that separates it from its neighbour. When a comment stands in
 *  that gap, only the item and the comma go: the comment and its line break stay where they are. */
function flowItemRemoval(
  text: string,
  item: readonly [number, number, ...number[]],
  preceding: number | undefined,
  following: number | undefined,
): Splice[] {
  const [start, end] = item;
  const gap: [number, number] | null =
    following !== undefined
      ? [end, following]
      : preceding !== undefined
        ? [preceding, start]
        : null;
  if (gap === null) {
    return [{ start, end, text: "" }];
  }
  const comma = flowComma(text, gap[0], gap[1]);
  if (comma === null || !text.slice(gap[0], gap[1]).includes("#")) {
    return following !== undefined
      ? [{ start, end: following, text: "" }]
      : [{ start: preceding ?? start, end, text: "" }];
  }
  const commaSplice = { start: comma, end: comma + 1, text: "" };
  const itemSplice = { start, end, text: "" };
  return comma < start ? [commaSplice, itemSplice] : [itemSplice, commaSplice];
}

function planSplice(operation: SpliceOperation, geometry: Geometry): Planned {
  const { text } = geometry;
  if (operation.start > operation.end || operation.end > text.length) {
    return fail(RANGE_OUT_OF_BOUNDS, {
      reason: "textRange",
      start: operation.start,
      end: operation.end,
      length: text.length,
    });
  }
  return ok([{ start: operation.start, end: operation.end, text: operation.text }]);
}

/** A scalar as GitLab will read it back: Psych is YAML 1.1, where `yes`, `on` or `012` are not
 *  strings, so they are quoted. A flow indicator is quoted too, the value may land in a flow list. */
function scalarText(value: string): string {
  const plain = stringify(value, { lineWidth: 0, version: "1.1" }).replace(/\r?\n$/, "");
  return plain.includes("\n") || /[,[\]{}]/.test(plain) ? JSON.stringify(value) : plain;
}

/** A block job, with no anchor or alias: copied into another file, an alias would no longer have a
 *  target, and an anchor could collide with the user's own. */
function snippetJob(snippet: string): { key: AnyNode; map: YAMLMap } | null {
  const document = parseDocument(snippet);
  const root = document.contents as AnyNode;
  if (document.errors.length > 0 || !isMap(root) || root.flow === true || root.items.length !== 1) {
    return null;
  }
  const [pair] = root.items;
  const map = pair?.value as AnyNode;
  if (
    pair === undefined ||
    !isScalar(pair.key) ||
    typeof pair.key.value !== "string" ||
    !isLegalJobName(pair.key.value) ||
    !isMap(map) ||
    map.flow === true ||
    map.items.length === 0
  ) {
    return null;
  }

  let shared = false;
  visit(document, {
    Alias() {
      shared = true;
    },
    Node(_key, node) {
      if (isNode(node) && (node as { anchor?: string }).anchor !== undefined) {
        shared = true;
      }
    },
  });
  return shared ? null : { key: pair.key as AnyNode, map };
}

function planAddSnippet(
  operation: AddSnippetOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const { id, stage, snippet } = operation;
  if (!isLegalJobName(id)) {
    return fail(INVALID_NAME, { reason: "job", name: id });
  }
  if (localPair(root, id) !== undefined) {
    return fail(NAME_CONFLICT, { name: id });
  }
  const taken = takenByInclude(pipeline, id);
  if (taken !== null) {
    return fail(FROM_INCLUDED_FILE, { reason: "nameTaken", name: id, file: taken });
  }
  if (!pipeline.stages.some((entry) => entry.name === stage)) {
    return fail(STAGE_NOT_FOUND, { stage });
  }

  const job = snippetJob(snippet);
  if (job === null) {
    return fail(INVALID_OPERATION, { reason: "invalidSnippet" });
  }

  const keyRange = nodeRange(job.key);
  const stagePair = localPair(job.map, "stage");
  const stageValue = stagePair?.value as AnyNode;
  const stageRange =
    isScalar(stageValue) && typeof stageValue.value === "string" && stageValue.value !== ""
      ? nodeRange(stageValue)
      : null;
  const preamble = keyRange === undefined ? "" : snippet.slice(0, keyRange[0]);
  // An indented key or comment would attach itself to the last job of the file.
  const indented = /^[ \t]+\S/m.test(preamble) || !/(^|\n)$/.test(preamble);
  if (keyRange === undefined || indented || (stagePair !== undefined && !stageRange)) {
    return fail(INVALID_OPERATION, { reason: "invalidSnippet" });
  }

  const firstKey = nodeRange(job.map.items[0]?.key as AnyNode);
  const indent = " ".repeat(
    (firstKey?.[0] ?? 2) - (snippet.lastIndexOf("\n", firstKey?.[0] ?? 0) + 1),
  );
  const edits = [
    { start: keyRange[0], end: keyRange[1], text: scalarText(id) },
    stageRange
      ? { start: stageRange[0], end: stageRange[1], text: scalarText(stage) }
      : {
          start: snippet.indexOf("\n", keyRange[1]) + 1,
          end: snippet.indexOf("\n", keyRange[1]) + 1,
          text: `${indent}stage: ${scalarText(stage)}\n`,
        },
  ].sort((left, right) => right.start - left.start);
  const rewritten = edits.reduce(
    (text, edit) => `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`,
    snippet,
  );

  const { text, eol } = geometry;
  const body = `${rewritten.trimEnd().replace(/\r?\n/g, eol)}${eol}`;
  const glue = text.length > 0 && !text.endsWith(eol) ? eol : "";
  return ok([{ start: text.length, end: text.length, text: `${glue}${eol}${body}` }]);
}

function planFor(
  operation: Exclude<Operation, CompositeOperation>,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  switch (operation.kind) {
    case "addJob":
      return planAddJob(operation, geometry, root, pipeline);
    case "removeJob":
      return planRemoveJob(operation, geometry, root, pipeline);
    case "renameJob":
      return planRenameJob(operation, root, pipeline);
    case "setJobStage":
      return planSetJobStage(operation, geometry, root, pipeline);
    case "addNeed":
      return planAddNeed(operation, geometry, root, pipeline);
    case "removeNeed":
      return planRemoveNeed(operation, geometry, root, pipeline);
    case "setEnvironment":
      return planSetEnvironment(operation, geometry, root, pipeline);
    case "addStage":
      return planAddStage(operation, geometry, root, pipeline);
    case "moveStage":
      return planMoveStage(operation, geometry, root, pipeline);
    case "splice":
      return planSplice(operation, geometry);
    case "addSnippet":
      return planAddSnippet(operation, geometry, root, pipeline);
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Steps are applied in memory: nothing exists until all of them have passed. The inverse is
 *  computed on the final text, from the first to the last differing byte (ADR 0012). */
function applyComposite(
  document: GitlabDocument,
  operation: CompositeOperation,
): Result<ApplyOk, ApplyError> {
  let current = document;
  let last: ApplyOk | null = null;
  for (const step of operation.steps) {
    const result = apply(current, { v: 1, baseHash: current.hash, ...step });
    if (!result.ok) {
      return result;
    }
    last = result.value;
    current = result.value.document;
  }
  if (last === null) {
    return fail(INVALID_OPERATION, { reason: "schema", path: "steps", detail: "empty" });
  }

  const before = document.text;
  const after = last.text;
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
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) {
    suffix -= 1;
  }

  const end = after.length - suffix;
  return ok({
    ...last,
    inverse: {
      v: 1,
      baseHash: last.hash,
      kind: "splice",
      start: prefix,
      end,
      text: before.slice(prefix, before.length - suffix),
    },
    touched: [{ start: prefix, end }],
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

/** The list read back must be the one requested: an inherited one resurfacing, or a misread
 *  shared list, shows up here whatever the hand-written form. */
function needsAsExpected(
  operation: AddNeedOperation | RemoveNeedOperation,
  before: { pipeline: Pipeline },
  after: { pipeline: Pipeline },
): boolean {
  const listed = (pipeline: Pipeline): Need[] =>
    pipeline.jobs.find((job) => job.id === operation.id)?.needs?.value ?? [];
  const sorted = (needs: readonly Need[]): string =>
    JSON.stringify(
      needs
        .map(({ job, optional, artifacts }) => [job, optional, artifacts])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
  const current = listed(before.pipeline);
  const expected =
    operation.kind === "addNeed"
      ? [
          ...current,
          {
            job: operation.need.job,
            optional: operation.need.optional ?? false,
            artifacts: operation.need.artifacts ?? true,
          },
        ]
      : current.filter((need) => need.job !== operation.job);
  return sorted(listed(after.pipeline)) === sorted(expected);
}

/** Every re-read in `apply` goes through here: a bare `parse(text)` would lose the file name and
 *  the include reader, so the re-read IR would no longer have the jobs of included files. */
function reparse(document: GitlabDocument, text: string) {
  return parse(text, { file: document.file, read: document.read ?? undefined });
}

function cycleCount(pipeline: Pipeline): number {
  return validate(pipeline).filter((diagnostic) => diagnostic.code === NEEDS_CYCLE).length;
}

export function apply(document: GitlabDocument, operation: Operation): Result<ApplyOk, ApplyError> {
  const validated = parseOperation(operation);
  if (!validated.ok) {
    return err<ApplyError>(validated.error);
  }
  const op = validated.value;

  if (op.baseHash !== document.hash) {
    return fail(STALE_DOCUMENT, { expected: document.hash, received: op.baseHash });
  }

  if (op.kind === "composite") {
    return applyComposite(document, op);
  }

  const before = reparse(document, document.text);
  const root = topLevelMap(document);

  const geometry: Geometry = {
    text: document.text,
    eol: eolOf(document.text),
    indent: indentUnit(document.text),
    reparse: (text) => reparse(document, text).pipeline,
  };

  if (root === null && op.kind !== "splice") {
    return fail(INVALID_OPERATION, { reason: "noRootMap" });
  }

  const planned =
    op.kind === "splice"
      ? planSplice(op, geometry)
      : planFor(op, geometry, root ?? new YAMLMap(), before.pipeline);
  if (!planned.ok) {
    return planned;
  }

  const spliced = applySplices(document.text, planned.value);
  const after = reparse(document, spliced.text);

  const brokeYaml =
    op.kind !== "splice" &&
    after.diagnostics.some((diagnostic) => diagnostic.code === INVALID_YAML) &&
    !before.diagnostics.some((diagnostic) => diagnostic.code === INVALID_YAML);
  if (brokeYaml) {
    return fail(INVALID_OPERATION, { reason: "wouldBreakYaml", operation: op.kind });
  }

  // A removed anchor leaves a dangling alias, which `parse` does not report.
  if (op.kind !== "splice" && danglingAliases(spliced.text) > danglingAliases(document.text)) {
    return fail(INVALID_OPERATION, { reason: "wouldBreakYaml", operation: op.kind });
  }

  if ((op.kind === "addNeed" || op.kind === "removeNeed") && !needsAsExpected(op, before, after)) {
    return fail(INVALID_OPERATION, { reason: "sharedValue", job: op.id, key: "needs" });
  }

  if (op.kind !== "splice" && cycleCount(after.pipeline) > cycleCount(before.pipeline)) {
    return fail(CYCLE, { operation: op.kind });
  }

  const first = spliced.touched[0];
  const lastTouched = spliced.touched.at(-1);
  const firstSplice = [...planned.value].sort((left, right) => left.start - right.start)[0];
  const lastSplice = [...planned.value].sort((left, right) => left.start - right.start).at(-1);

  const inverse: SpliceOperation =
    first === undefined ||
    lastTouched === undefined ||
    firstSplice === undefined ||
    lastSplice === undefined
      ? { v: 1, baseHash: after.hash, kind: "splice", start: 0, end: 0, text: "" }
      : {
          v: 1,
          baseHash: after.hash,
          kind: "splice",
          start: first.start,
          end: lastTouched.end,
          text: document.text.slice(firstSplice.start, lastSplice.end),
        };

  return ok({
    text: spliced.text,
    document: after.document,
    pipeline: after.pipeline,
    diagnostics: after.diagnostics,
    hash: after.hash,
    inverse,
    touched: spliced.touched,
    included: after.included,
  });
}
