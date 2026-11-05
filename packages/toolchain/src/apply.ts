import type {
  IntegrationKind,
  OperationError,
  Result,
  SourceRange,
  SpliceOperation,
  Toolchain,
  ToolchainOperation,
} from "@keelson/core";
import {
  err,
  hashText,
  INTEGRATION_EXISTS,
  INTEGRATION_NOT_FOUND,
  INVALID_NAME,
  INVALID_OPERATION,
  isLegalServiceId,
  NAME_CONFLICT,
  ok,
  RANGE_OUT_OF_BOUNDS,
  SERVICE_NOT_FOUND,
  SERVICE_REFERENCED,
  STALE_DOCUMENT,
  TOOLCHAIN_INVALID,
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
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { expectedToolchain } from "./model.ts";
import { parseToolchain } from "./parse.ts";

export type ToolchainResult = {
  text: string;
  hash: string;
  toolchain: Toolchain;
  inverse: SpliceOperation;
  touched: SourceRange[];
};

type Edit = { start: number; end: number; text: string };

type Refusal = { refused: OperationError };

const refuse = (error: OperationError): Refusal => ({ refused: error });

const flow = (section: string): Refusal =>
  refuse({ code: INVALID_OPERATION, params: { reason: "flowStyleToolchain", section } });

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** Après le saut de ligne : la fin de ligne d'un commentaire en bout de valeur en fait partie. */
function lineEnd(text: string, offset: number): number {
  const found = text.indexOf("\n", offset);
  return found === -1 ? text.length : found + 1;
}

function column(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

function rangeOf(node: Node): [number, number] {
  const [start, end] = node.range ?? [0, 0];
  return [start, end];
}

/** Où finit réellement un nœud. `range` d'une collection en bloc inclut ce qui suit sa dernière
 *  valeur, donc les commentaires du voisin, et celui d'un scalaire `|` ou `>` inclut son saut de
 *  ligne final : on descend jusqu'à la dernière feuille, puis jusqu'à son dernier caractère. */
function contentEnd(text: string, node: Node): number {
  if (isMap(node) && !node.flow) {
    const last = node.items.at(-1);
    return last === undefined ? rangeOf(node)[1] : pairEnd(text, last);
  }
  if (isSeq(node) && !node.flow) {
    const last = node.items.at(-1) as Node | undefined;
    return last === undefined ? rangeOf(node)[1] : contentEnd(text, last);
  }
  const [start, end] = rangeOf(node);
  if (isScalar(node) && (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED")) {
    return start + text.slice(start, end).trimEnd().length;
  }
  return end;
}

function pairEnd(text: string, pair: Pair): number {
  const value = pair.value as Node | null;
  const end = value === null ? 0 : contentEnd(text, value);
  return Math.max(end, rangeOf(pair.key as Node)[1]);
}

function afterColon(text: string, key: Node): number {
  return text.indexOf(":", rangeOf(key)[1]) + 1;
}

/** Un alias ailleurs dépend peut-être de cette ancre : la retirer le laisserait sans cible. */
function hasAnchor(node: Node | null): boolean {
  if (node === null || isAlias(node)) {
    return false;
  }
  if (node.anchor !== undefined) {
    return true;
  }
  if (isMap(node)) {
    return node.items.some((pair) => hasAnchor(pair.value as Node | null));
  }
  return isSeq(node) && node.items.some((item) => hasAnchor(item as Node | null));
}

function pairOf(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => isScalar(pair.key) && pair.key.value === key);
}

/** `stringify` plie les longues chaînes et laisse passer `---` : seul ce qui se relit à l'identique
 *  est gardé tel quel, le reste part en double quotes, que YAML relit toujours. */
function scalarText(value: string): string {
  const plain = stringify(value, { lineWidth: 0 }).replace(/\r?\n$/, "");
  const line = `key: ${plain}\n`;
  const document = parseDocument(line);
  const faithful =
    !plain.includes("\n") && document.errors.length === 0 && document.get("key") === value;
  return faithful ? plain : JSON.stringify(value);
}

function isEmpty(node: Node | null): boolean {
  return (
    node === null ||
    (isScalar(node) && node.value === null) ||
    (isCollection(node) && node.items.length === 0)
  );
}

function lines(entries: readonly string[], indent: number, eol: string): string {
  return entries.map((line) => `${" ".repeat(indent)}${line}${eol}`).join("");
}

class Editing {
  readonly eol: string;

  constructor(
    readonly text: string,
    readonly root: YAMLMap | null,
  ) {
    this.eol = text.includes("\r\n") ? "\r\n" : "\n";
  }

  private appendAtEnd(block: string): Edit {
    // Après un `...` final, YAML ouvrirait un autre document.
    const marker = this.text.search(/^\.\.\.[ \t]*(#.*)?\r?\n?\s*$/m);
    const end = marker === -1 ? this.text.length : marker;
    const glue = end === 0 || this.text.slice(0, end).endsWith("\n") ? "" : this.eol;
    const header = this.root === null ? `version: 1${this.eol}` : "";
    return { start: end, end, text: `${glue}${header}${block}` };
  }

  /** `entry` reçoit l'indentation à employer et rend le bloc à insérer. */
  insertInto(
    section: string,
    indentOf: (collection: YAMLMap | YAMLSeq) => number,
    entry: (indent: number) => string,
  ): Edit | Refusal {
    const pair = this.root === null ? undefined : pairOf(this.root, section);
    if (pair === undefined) {
      return this.appendAtEnd(`${section}:${this.eol}${entry(2)}`);
    }

    const value = pair.value as Node | null;
    if (isEmpty(value)) {
      // `~`, `null` ou `[]` disparaissent ; ce qui suit sur la ligne, un commentaire, y reste.
      const start = afterColon(this.text, pair.key as Node);
      const end = lineEnd(this.text, start);
      const line = this.text.slice(start, end);
      const comment = line.search(/(^|\s)#/);
      const tail = comment === -1 ? "" : line.slice(comment);
      return {
        start,
        end,
        text: `${tail.trimEnd()}${this.eol}${entry(2)}`,
      };
    }

    if (!isCollection(value) || value.flow === true) {
      return flow(section);
    }

    const offset = lineEnd(this.text, contentEnd(this.text, value));
    const glue = this.text.endsWith("\n") || offset < this.text.length ? "" : this.eol;
    return { start: offset, end: offset, text: `${glue}${entry(indentOf(value))}` };
  }

  /** De la ligne de la clé à la fin de sa valeur : les commentaires au-dessus restent au voisin. */
  pairSpan(pair: Pair): Edit {
    return {
      start: lineStart(this.text, rangeOf(pair.key as Node)[0]),
      end: lineEnd(this.text, pairEnd(this.text, pair)),
      text: "",
    };
  }

  itemSpan(item: Node): Edit {
    let start = lineStart(this.text, rangeOf(item)[0]);
    while (start > 0 && !this.text.slice(start).trimStart().startsWith("-")) {
      start = lineStart(this.text, start - 1);
    }
    return { start, end: lineEnd(this.text, contentEnd(this.text, item)), text: "" };
  }

  dashColumn(sequence: YAMLSeq): number {
    const first = sequence.items[0] as Node;
    return this.itemSpan(first).start === lineStart(this.text, rangeOf(first)[0])
      ? this.text.slice(this.itemSpan(first).start).search(/\S/)
      : column(this.text, rangeOf(first)[0]) - 2;
  }
}

function serviceLines(
  id: string,
  fields: { tool: string; url: string | null; environment: string | null },
): string[] {
  return [
    `${scalarText(id)}:`,
    `  tool: ${scalarText(fields.tool)}`,
    ...(fields.url === null ? [] : [`  url: ${scalarText(fields.url)}`]),
    ...(fields.environment === null ? [] : [`  environment: ${scalarText(fields.environment)}`]),
  ];
}

function updateFields(
  editing: Editing,
  id: string,
  service: Pair,
  fields: Record<string, string | null | undefined>,
): Edit[] | Refusal {
  const map = service.value;
  const shared = (key: string): Refusal =>
    refuse({ code: INVALID_OPERATION, params: { reason: "sharedValue", job: id, key } });
  if (isAlias(map) || (isMap(map) && map.anchor !== undefined)) {
    return shared("service");
  }
  if (!isMap(map) || map.flow === true) {
    return flow(`services.${id}`);
  }

  const indent = column(editing.text, rangeOf(map.items[0]?.key as Node)[0]);
  const after = lineEnd(editing.text, contentEnd(editing.text, map));
  const edits: Edit[] = [];
  let glued = editing.text.endsWith("\n") || after < editing.text.length;

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    const pair = pairOf(map, key);
    if (pair === undefined) {
      if (value !== null) {
        const glue = glued ? "" : editing.eol;
        glued = true;
        edits.push({
          start: after,
          end: after,
          text: `${glue}${lines([`${key}: ${scalarText(value)}`], indent, editing.eol)}`,
        });
      }
      continue;
    }

    if (value === null) {
      if ((pair.value as Node | null)?.anchor !== undefined) {
        return shared(key);
      }
      edits.push(editing.pairSpan(pair));
      continue;
    }

    const current = pair.value as Node | null;
    if (current !== null && (!isScalar(current) || current.anchor !== undefined)) {
      return shared(key);
    }
    const start = current === null ? 0 : rangeOf(current)[0];
    const end = current === null ? 0 : contentEnd(editing.text, current);
    const empty = current === null || start === end;
    const colon = afterColon(editing.text, pair.key as Node);
    edits.push(
      empty
        ? { start: colon, end: colon, text: ` ${scalarText(value)}` }
        : { start, end, text: scalarText(value) },
    );
  }

  return edits;
}

/** Plusieurs champs d'un même service : une seule plage touchée, un seul inverse. Le texte entre
 *  deux éditions est repris tel quel. */
function compose(text: string, edits: readonly Edit[]): Edit | null {
  const sorted = [...edits].sort((left, right) => left.start - right.start);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }

  let cursor = first.start;
  let replacement = "";
  for (const edit of sorted) {
    replacement += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return { start: first.start, end: Math.max(cursor, last.end), text: replacement };
}

function sectionItem(root: YAMLMap | null, section: string, position: number): Node | undefined {
  const value = root === null ? undefined : pairOf(root, section)?.value;
  return isSeq(value) ? (value.items[position] as Node | undefined) : undefined;
}

function planned(
  editing: Editing,
  current: Toolchain,
  operation: Exclude<ToolchainOperation, SpliceOperation>,
): Edit | null | Refusal {
  const pairOfService = (id: string): Pair | undefined => {
    const section = editing.root === null ? undefined : pairOf(editing.root, "services");
    return isMap(section?.value) ? pairOf(section.value, id) : undefined;
  };
  const mapIndent = (collection: YAMLMap | YAMLSeq): number =>
    column(editing.text, rangeOf((collection as YAMLMap).items[0]?.key as Node)[0]);
  const seqIndent = (collection: YAMLMap | YAMLSeq): number =>
    editing.dashColumn(collection as YAMLSeq);

  const listed = (
    section: "integrations" | "dismissed",
    job: string,
    target: string,
    kind: IntegrationKind,
  ): number =>
    (section === "integrations"
      ? current.integrations.map((entry) => ({ ...entry, target: entry.service }))
      : current.dismissed.map((entry) => ({ ...entry, target: entry.tool }))
    ).findIndex((entry) => entry.job === job && entry.target === target && entry.kind === kind);

  const insertItem = (
    section: "integrations" | "dismissed",
    field: "service" | "tool",
    job: string,
    target: string,
    kind: IntegrationKind,
  ) =>
    editing.insertInto(section, seqIndent, (indent) =>
      lines(
        [
          `- job: ${scalarText(job)}`,
          `  ${field}: ${scalarText(target)}`,
          `  kind: ${scalarText(kind)}`,
        ],
        indent,
        editing.eol,
      ),
    );

  const removeItem = (
    section: "integrations" | "dismissed",
    job: string,
    target: string,
    kind: IntegrationKind,
  ): Edit | Refusal => {
    const position = listed(section, job, target, kind);
    const item = position === -1 ? undefined : sectionItem(editing.root, section, position);
    if (item === undefined) {
      return refuse({ code: INTEGRATION_NOT_FOUND, params: { job, target, kind } });
    }
    const value = editing.root === null ? null : pairOf(editing.root, section)?.value;
    return isSeq(value) && value.flow === true ? flow(section) : editing.itemSpan(item);
  };

  switch (operation.kind) {
    case "addService": {
      if (!isLegalServiceId(operation.id)) {
        return refuse({
          code: INVALID_NAME,
          params: { reason: "service", name: operation.id },
        });
      }
      if (current.services.some((service) => service.id === operation.id)) {
        return refuse({ code: NAME_CONFLICT, params: { name: operation.id } });
      }
      return editing.insertInto("services", mapIndent, (indent) =>
        lines(serviceLines(operation.id, operation), indent, editing.eol),
      );
    }

    case "updateService": {
      const pair = pairOfService(operation.id);
      if (pair === undefined) {
        return refuse({ code: SERVICE_NOT_FOUND, params: { service: operation.id } });
      }
      const edits = updateFields(editing, operation.id, pair, {
        tool: operation.tool,
        url: operation.url,
        environment: operation.environment,
      });
      return Array.isArray(edits) ? compose(editing.text, edits) : edits;
    }

    case "removeService": {
      const pair = pairOfService(operation.id);
      if (pair === undefined) {
        return refuse({ code: SERVICE_NOT_FOUND, params: { service: operation.id } });
      }
      const jobs = current.integrations
        .filter((entry) => entry.service === operation.id)
        .map((entry) => entry.job)
        .sort();
      if (jobs.length > 0) {
        return refuse({
          code: SERVICE_REFERENCED,
          params: { service: operation.id, jobs: [...new Set(jobs)] },
        });
      }
      if (hasAnchor(pair.value as Node | null)) {
        return refuse({
          code: INVALID_OPERATION,
          params: { reason: "sharedValue", job: operation.id, key: "service" },
        });
      }
      return editing.pairSpan(pair);
    }

    case "addIntegration": {
      const { job, service, integration } = operation;
      if (!current.services.some((entry) => entry.id === service)) {
        return refuse({ code: SERVICE_NOT_FOUND, params: { service } });
      }
      if (listed("integrations", job, service, integration) !== -1) {
        return refuse({
          code: INTEGRATION_EXISTS,
          params: { job, target: service, kind: integration },
        });
      }
      return insertItem("integrations", "service", job, service, integration);
    }

    case "removeIntegration":
      return removeItem("integrations", operation.job, operation.service, operation.integration);

    case "dismissIntegration": {
      const { job, tool, integration } = operation;
      if (listed("dismissed", job, tool, integration) !== -1) {
        return refuse({
          code: INTEGRATION_EXISTS,
          params: { job, target: tool, kind: integration },
        });
      }
      return insertItem("dismissed", "tool", job, tool, integration);
    }

    case "restoreIntegration":
      return removeItem("dismissed", operation.job, operation.tool, operation.integration);
  }
}

function finish(text: string, edit: Edit | null): ToolchainResult {
  const next =
    edit === null ? text : `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
  const hash = hashText(next);
  const { start, end, replaced } =
    edit === null
      ? { start: 0, end: 0, replaced: "" }
      : {
          start: edit.start,
          end: edit.start + edit.text.length,
          replaced: text.slice(edit.start, edit.end),
        };
  return {
    text: next,
    hash,
    toolchain: parseToolchain(next).toolchain,
    inverse: { v: 1, baseHash: hash, kind: "splice", start, end, text: replaced },
    touched: edit === null ? [] : [{ start, end }],
  };
}

export function applyToolchain(
  text: string,
  operation: ToolchainOperation,
): Result<ToolchainResult, OperationError> {
  const hash = hashText(text);
  if (operation.baseHash !== hash) {
    return err({
      code: STALE_DOCUMENT,
      params: { expected: hash, received: operation.baseHash },
    });
  }

  if (operation.kind === "splice") {
    if (operation.start > operation.end || operation.end > text.length) {
      return err({
        code: RANGE_OUT_OF_BOUNDS,
        params: {
          reason: "textRange",
          start: operation.start,
          end: operation.end,
          length: text.length,
        },
      });
    }
    return ok(finish(text, operation));
  }

  const { toolchain, diagnostics } = parseToolchain(text);
  if (diagnostics.some((entry) => entry.code === TOOLCHAIN_INVALID)) {
    return err({ code: INVALID_OPERATION, params: { reason: "invalidToolchain" } });
  }

  const document: Document.Parsed = parseDocument(text);
  const contents = document.contents;
  if (contents !== null && !isMap(contents)) {
    return err({ code: INVALID_OPERATION, params: { reason: "noRootMap" } });
  }
  if (isMap(contents) && contents.flow === true) {
    return err({
      code: INVALID_OPERATION,
      params: { reason: "flowStyleToolchain", section: "root" },
    });
  }

  const edit = planned(new Editing(text, contents), toolchain, operation);
  if (edit !== null && "refused" in edit) {
    return err(edit.refused);
  }

  const result = finish(text, edit);
  const read = parseToolchain(result.text);
  const faithful =
    JSON.stringify(read.toolchain) === JSON.stringify(expectedToolchain(toolchain, operation));
  if (read.diagnostics.length > 0 || !faithful) {
    return err({
      code: INVALID_OPERATION,
      params: { reason: "wouldBreakYaml", operation: operation.kind },
    });
  }
  return ok(result);
}
