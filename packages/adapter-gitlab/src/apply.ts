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
import { DEFAULT_STAGES } from "./defaults.ts";
import type { GitlabDocument } from "./document.ts";
import { applySplices, type Splice } from "./emit.ts";
import { parse } from "./parse.ts";
import { type AnyNode, localPair, localPairs, pairRange, REFERENCE_TAG } from "./resolve.ts";
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

  if (map.flow === true) {
    // DEBT(2026-10-20): jobs written in flow style ({ … }) are not editable
    // — patching in place would assume a line-based rendering. See specs/gaps.md (2026-10-20), milestone to be defined.
    return fail(INVALID_OPERATION, { reason: "flowStyleJob", job: id });
  }

  return ok({ pair, map });
}

function overrideInsertAt(geometry: Geometry, target: Target): number {
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
    `${indent}stage: ${job.stage}${eol}`,
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
      return ok([{ ...range, text: operation.stage }]);
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
    return ok([{ start: keyStart, end, text: `stage: ${operation.stage}` }]);
  }

  const at = overrideInsertAt(geometry, located.value);
  return ok([
    { start: at, end: at, text: `${geometry.indent}stage: ${operation.stage}${geometry.eol}` },
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
  // A shared list is not extended in place: the replacement would lose its items, and an item
  // added to a `!reference` would be a wrong path. Keelson does not rewrite what it shares.
  if (isAlias(seq) || (seq as { tag?: string }).tag === REFERENCE_TAG) {
    return fail(INVALID_OPERATION, { reason: "sharedValue", job: operation.id, key: "needs" });
  }

  const items = seqItems(seq);
  const last = items.at(-1);

  if (isSeq(seq) && seq.flow === true) {
    if (last === undefined) {
      const range = valueContent(seq);
      return range === null
        ? fail(RANGE_OUT_OF_BOUNDS, { reason: "needsKey" })
        : ok([{ ...range, text: `[${added.job}]` }]);
    }
    const end = nodeRange(last)?.[1];
    return end === undefined
      ? fail(RANGE_OUT_OF_BOUNDS, { reason: "lastNeed" })
      : ok([{ start: end, end, text: `, ${added.job}` }]);
  }

  if (last === undefined) {
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

  if (local === undefined) {
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

  if (operation.environment === null) {
    if (local !== undefined) {
      const range = pairLineRange(geometry.text, local);
      return range === null
        ? fail(RANGE_OUT_OF_BOUNDS, { reason: "environmentKey" })
        : ok([{ ...range, text: "" }]);
    }
    if (inherited !== null) {
      // DEBT(2026-10-20): no mechanism to cancel an inherited environment
      // — GitLab has no cancellation key. See specs/gaps.md (2026-10-20, 2026-11-04), milestone to be defined.
      return fail(INVALID_OPERATION, {
        reason: "inheritedEnvironment",
        job: operation.id,
        origin: inherited.origin.kind,
      });
    }
    return ok([]);
  }

  const environment = operation.environment;

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
  const body = names.map((name) => `${indent}- ${name}${eol}`).join("");
  const first = localPairs(root)[0];
  const at = nodeRange(first?.key as AnyNode)?.[0] ?? 0;
  return { start: at, end: at, text: `stages:${eol}${body}${eol}` };
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

  const index = operation.index ?? pipeline.stages.length;
  if (index > pipeline.stages.length) {
    return fail(RANGE_OUT_OF_BOUNDS, {
      reason: "stageIndex",
      index,
      count: pipeline.stages.length,
    });
  }

  const declared = stagesSeq(root);
  if (declared === null) {
    const names: string[] = [...DEFAULT_STAGES];
    names.splice(index, 0, operation.name);
    return ok([materialiseStages(names, geometry, root)]);
  }

  const items = declared.seq.items as Node[];
  const { text, eol } = geometry;

  if (declared.seq.flow === true) {
    const anchor = items[index];
    if (anchor !== undefined) {
      const start = nodeRange(anchor)?.[0];
      return start === undefined
        ? fail(RANGE_OUT_OF_BOUNDS, { reason: "stageList" })
        : ok([{ start, end: start, text: `${operation.name}, ` }]);
    }
    const last = items.at(-1);
    const end = last === undefined ? undefined : nodeRange(last)?.[1];
    return end === undefined
      ? fail(RANGE_OUT_OF_BOUNDS, { reason: "stageList" })
      : ok([{ start: end, end, text: `, ${operation.name}` }]);
  }

  const anchor = items[index];
  if (anchor !== undefined) {
    const anchorStart = nodeRange(anchor)?.[0];
    if (anchorStart === undefined) {
      return fail(RANGE_OUT_OF_BOUNDS, { reason: "stageList" });
    }
    const at = lineStart(text, anchorStart);
    return ok([
      { start: at, end: at, text: `${itemPrefix(text, anchorStart)}${operation.name}${eol}` },
    ]);
  }

  const last = items.at(-1);
  const lastRange = last === undefined ? undefined : nodeRange(last);
  if (lastRange === undefined) {
    return fail(RANGE_OUT_OF_BOUNDS, { reason: "emptyStageList" });
  }
  return ok([
    {
      start: lastRange[2],
      end: lastRange[2],
      text: `${itemPrefix(text, lastRange[0])}${operation.name}${eol}`,
    },
  ]);
}

function planMoveStage(
  operation: MoveStageOperation,
  geometry: Geometry,
  root: YAMLMap,
  pipeline: Pipeline,
): Planned {
  const names = pipeline.stages.map((stage) => stage.name);
  const from = names.indexOf(operation.name);
  if (from === -1) {
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

  const declared = stagesSeq(root);
  const reordered = names.filter((name) => name !== operation.name);
  reordered.splice(operation.toIndex, 0, operation.name);

  if (reordered.every((name, position) => name === names[position])) {
    return ok([]);
  }

  if (declared === null) {
    return ok([materialiseStages(reordered, geometry, root)]);
  }

  const items = declared.seq.items as Node[];
  const victim = items[from];
  const victimRange = victim === undefined ? undefined : nodeRange(victim);
  if (victimRange === undefined) {
    return fail(RANGE_OUT_OF_BOUNDS, { reason: "stageList" });
  }

  const { text, eol } = geometry;
  const prefix = linePrefix(text, victimRange[0]);
  const line = `${prefix}${operation.name}${eol}`;
  const removal: Splice = { start: lineStart(text, victimRange[0]), end: victimRange[2], text: "" };

  const rest = items.filter((_, position) => position !== from);
  const anchor = rest[operation.toIndex];
  if (anchor !== undefined) {
    const anchorStart = nodeRange(anchor)?.[0];
    if (anchorStart === undefined) {
      return fail(RANGE_OUT_OF_BOUNDS, { reason: "stageList" });
    }
    const at = lineStart(text, anchorStart);
    return ok([removal, { start: at, end: at, text: line }]);
  }

  const last = rest.at(-1);
  const lastEnd = last === undefined ? undefined : nodeRange(last)?.[2];
  return lastEnd === undefined
    ? fail(RANGE_OUT_OF_BOUNDS, { reason: "emptyStageList" })
    : ok([removal, { start: lastEnd, end: lastEnd, text: line }]);
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

function jobKeyText(value: string): string {
  const plain = stringify(value, { lineWidth: 0 }).replace(/\r?\n$/, "");
  return plain.includes("\n") ? JSON.stringify(value) : plain;
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
    { start: keyRange[0], end: keyRange[1], text: jobKeyText(id) },
    stageRange
      ? { start: stageRange[0], end: stageRange[1], text: jobKeyText(stage) }
      : {
          start: snippet.indexOf("\n", keyRange[1]) + 1,
          end: snippet.indexOf("\n", keyRange[1]) + 1,
          text: `${indent}stage: ${jobKeyText(stage)}\n`,
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
