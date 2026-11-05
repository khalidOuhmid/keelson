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

/** Le fichier d'un élément, quand ce n'est **pas** le fichier principal. Keelson n'écrit jamais
 *  ailleurs que dans le fichier principal : c'est la garantie sur laquelle repose tout le reste —
 *  les plages, l'écriture atomique, la liste blanche du serveur. */
function foreignFile(pipeline: Pipeline, file: string): string | null {
  return file === pipeline.main ? null : file;
}

/** La liste `stages` vient d'un seul fichier : une liste écrase et ne fusionne pas. Un stage
 *  implicite porte le fichier principal, donc une liste absente reste matérialisable. */
function foreignStagesFile(pipeline: Pipeline): string | null {
  for (const stage of pipeline.stages) {
    const foreign = foreignFile(pipeline, stage.file);
    if (foreign !== null) {
      return foreign;
    }
  }
  return null;
}

/** Le nom est-il déjà pris dans un fichier inclus ? `addJob` et `renameJob` ne regardaient que le
 *  fichier principal, où le nom est libre : l'écriture aurait produit une **surcharge partielle**,
 *  un job qui hérite silencieusement des clés de l'include. */
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
    // DETTE(2026-10-20): les jobs écrits en flow style ({ … }) ne sont pas éditables
    // — le patch en place supposerait un rendu par ligne. À traiter avec l'éditeur de blocs du lot L2.
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

  // `needReferenceSplices` ne réécrit que le fichier principal. Un job d'un fichier inclus qui a
  // besoin de l'ancien nom garderait donc un `needs` cassé, et le renommage produirait un
  // UNKNOWN_NEED que l'utilisateur ne pourrait pas corriger depuis Keelson.
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
    // La plage d'un `!reference` commence après son tag : remplacer la valeur seule écrirait
    // `stage: !reference test`. La clé est donc réécrite avec, et la surcharge est explicite.
    // La fin d'une séquence en bloc emporte son saut de ligne et les commentaires qui suivent :
    // on s'arrête donc à la fin de son dernier item.
    const value = local.value as AnyNode;
    const tagged = (value as { tag?: string }).tag === REFERENCE_TAG;
    const keyStart = nodeRange(local.key as AnyNode)?.[0];
    const end =
      isSeq(value) && value.flow !== true ? nodeRange(seqItems(value).at(-1))?.[1] : range.end;
    if (!tagged || keyStart === undefined || end === undefined) {
      return ok([{ ...range, text: operation.stage }]);
    }

    // Une ancre, un commentaire ou une clé explicite vivent dans la plage réécrite : les perdre
    // sans le dire écrirait un fichier faux, donc on refuse.
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

/** Le début de ligne d'un item, sans son ancre ni son tag : les recopier sur un nouvel item
 *  déplacerait l'ancre, et tout alias changerait de valeur sans un mot. */
function itemPrefix(text: string, offset: number): string {
  const here = linePrefix(text, offset).replace(/[&!][^\s]*[ \t]+/g, "");
  if (here.includes("-")) {
    return here;
  }
  // Un item peut commencer sur la ligne d'avant : `- # note` puis sa valeur.
  const lines = text.slice(0, lineStart(text, offset)).split("\n");
  const dash = lines.toReversed().find((line) => /^\s*-(\s|$)/.test(line));
  return dash === undefined ? here : `${/^\s*/.exec(dash)?.[0] ?? ""}- `;
}

function rewritesCrossProject(pipeline: Pipeline, id: string): boolean {
  return pipeline.jobs.find((job) => job.id === id)?.crossProjectNeeds === true;
}

/** L'IR ne porte pas ces items : réécrire la liste les perdrait sans un mot. */
function crossProjectRefusal(job: string): Planned {
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
    if (rewritesCrossProject(pipeline, operation.id)) {
      return crossProjectRefusal(operation.id);
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
  // Une liste partagée ne s'étend pas en place : le remplacement perdrait ses items, et un item
  // ajouté à un `!reference` serait un chemin faux. Keelson ne réécrit pas ce qu'elle partage.
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
  return ok([{ start: lastRange[2], end: lastRange[2], text: renderNeedItem(added, prefix, eol) }]);
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
    rewritesCrossProject(pipeline, operation.id)
  ) {
    return crossProjectRefusal(operation.id);
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
      // DETTE(2026-10-20): pas de mécanisme pour annuler un environnement hérité
      // — GitLab n'a pas de clé d'annulation ; à trancher avec la vue Toolchain du lot L4.
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

  // Sans ce refus, `stagesSeq(root)` ne trouve rien dans le fichier principal et la suite
  // **matérialise** une liste de stages par défaut : la liste de l'include serait écrasée par
  // `.pre, build, test, deploy, .post` sans que rien ne le dise.
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

/** Un job en bloc, sans ancre ni alias : recopié dans un autre fichier, un alias n'aurait plus de
 *  cible, et une ancre pourrait entrer en collision avec celles de l'utilisateur. */
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
  // Une clé ou un commentaire indentés s'accrocheraient au dernier job du fichier.
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

/** Les étapes s'appliquent en mémoire : rien n'existe avant que toutes aient passé. L'inverse se
 *  calcule sur le texte final, du premier au dernier octet différent (ADR 0012). */
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

/** Toute relecture dans `apply` passe par ici : un `parse(texte)` nu perdrait le nom du fichier et
 *  le lecteur d'includes, donc l'IR relue n'aurait plus les jobs des fichiers inclus. */
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
