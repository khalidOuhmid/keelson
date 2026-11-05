import type { Tool } from "@keelson/catalog";
import type { Pipeline } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import type { LayerId } from "@keelson/taxonomy";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiFailure, ApiResult, OperationPayload } from "../../api/client.ts";
import { BUTTON, FIELD, GROUP, LABEL, SECTION_HEADING } from "../../editing/controls.ts";
import { type DiffRow, diffRows, visibleRows } from "../../editing/diff.ts";
import type { Draft } from "../../state/store.ts";
import { LayerTags } from "../coverage/LayerTag.tsx";

export type Insertion = {
  pipeline: Pipeline;
  text: string;
  disabled: boolean;
  preview: (draft: Draft) => Promise<ApiResult<OperationPayload>>;
  /** `job` reçoit le focus une fois l'écriture faite. Rend l'échec, ou `null`. */
  onInsert: (draft: Draft, job: string) => Promise<ApiFailure | null>;
};

export type InsertToolProps = Insertion & { tool: Tool };

function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function snippetStage(snippet: string): string | null {
  const indent = /^[ \t]+/m.exec(snippet)?.[0] ?? "";
  const line = new RegExp(`^${indent}stage:[ \\t]*(?:"([^"]+)"|'([^']+)'|([^\\s#]+))`, "m").exec(
    snippet,
  );
  return line?.[1] ?? line?.[2] ?? line?.[3] ?? null;
}

function draftFor(id: string, stage: string, snippet: string, pipeline: Pipeline): Draft {
  const add = { kind: "addSnippet", id, stage, snippet } as const;
  return pipeline.stages.some((entry) => entry.name === stage)
    ? add
    : { kind: "composite", steps: [{ kind: "addStage", name: stage }, add] };
}

type Answer = { draft: Draft; payload: OperationPayload } | { draft: Draft; failure: ApiFailure };

function Row({ row }: { row: DiffRow }) {
  if (row.kind === "same") {
    return (
      <span className="block whitespace-pre-wrap break-words text-text-muted"> {row.text}</span>
    );
  }
  const added = row.kind === "add";
  const Mark = added ? "ins" : "del";
  return (
    <Mark
      className={`block whitespace-pre-wrap break-words no-underline ${added ? "bg-surface-2 text-text-primary" : "bg-danger-muted/20 text-danger"}`}
    >
      <span className="sr-only">{added ? "added: " : "removed: "}</span>
      <span aria-hidden="true">{added ? "+" : "-"}</span>
      {row.text}
    </Mark>
  );
}

function Form({
  tool,
  snippet,
  pipeline,
  text,
  disabled,
  preview,
  onInsert,
  onCancel,
}: InsertToolProps & { snippet: string; onCancel: () => void }) {
  const taken = useMemo(
    () => new Set([...pipeline.jobs, ...pipeline.templates].map((entry) => entry.id)),
    [pipeline],
  );
  const stages = pipeline.stages.map((stage) => stage.name);
  const wanted = snippetStage(snippet);
  const created = wanted !== null && !stages.includes(wanted) ? wanted : null;

  const [id, setId] = useState(() => freeName(tool.id, taken));
  const [stage, setStage] = useState(wanted ?? stages[0] ?? "test");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [lastDiff, setLastDiff] = useState<string | null>(null);
  const [writeFailure, setWriteFailure] = useState<ApiFailure | null>(null);
  const asked = useRef(0);
  const writing = useRef(false);
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => nameField.current?.focus(), []);

  const draft = useMemo(
    () => draftFor(id, stage, snippet, pipeline),
    [id, stage, snippet, pipeline],
  );

  useEffect(() => {
    if (writing.current) {
      return;
    }
    asked.current += 1;
    const turn = asked.current;
    void preview(draft).then((result) => {
      if (turn !== asked.current) {
        return;
      }
      setAnswer(result.ok ? { draft, payload: result.value } : { draft, failure: result.error });
      if (result.ok) {
        setLastDiff(result.value.text);
      }
    });
  }, [draft, preview]);

  // Le diff affiché doit être celui de ce qui partira : une réponse d'un autre brouillon ne compte pas.
  const settled = answer !== null && answer.draft === draft;
  const failure = settled && "failure" in answer ? answer.failure : null;
  const payload = settled && "payload" in answer ? answer.payload : null;

  const rows =
    lastDiff === null || failure !== null ? [] : visibleRows(diffRows(text, lastDiff), 2);
  const added = rows.filter((row) => row.kind === "add").length;
  const removed = rows.filter((row) => row.kind === "remove").length;
  const layers: readonly LayerId[] =
    payload?.coverage.jobs.find((job) => job.job === id)?.layers ?? [];

  const insert = async (): Promise<void> => {
    if (disabled || payload === null) {
      return;
    }
    writing.current = true;
    const refused = await onInsert(draft, id);
    writing.current = refused === null;
    setWriteFailure(refused);
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void insert();
      }}
    >
      <label className={GROUP}>
        <span className={LABEL}>Job name</span>
        <input
          ref={nameField}
          className={FIELD}
          value={id}
          disabled={disabled}
          aria-invalid={failure !== null}
          aria-describedby={failure === null ? undefined : "insert-refusal"}
          onChange={(event) => setId(event.target.value)}
        />
      </label>
      {failure === null ? null : (
        <p id="insert-refusal" role="alert" className="text-sm text-danger">
          {renderMessage(failure)}
        </p>
      )}
      <label className={GROUP}>
        <span className={LABEL}>Stage</span>
        <select
          className={FIELD}
          value={stage}
          disabled={disabled}
          onChange={(event) => setStage(event.target.value)}
        >
          {stages.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {created === null ? null : <option value={created}>{created} (new stage)</option>}
        </select>
      </label>

      {layers.length === 0 ? null : (
        <p data-testid="insert-layers" className="flex flex-wrap items-center gap-1 text-sm">
          <span className="text-text-muted">Covers</span>
          <LayerTags layers={layers} />
        </p>
      )}

      {rows.length === 0 ? null : (
        <figure className="flex flex-col gap-1">
          <figcaption className={SECTION_HEADING}>Changes to {pipeline.main}</figcaption>
          <pre
            data-testid="insert-diff"
            className="rounded-sm border border-border-default bg-surface-inset p-1 font-mono text-xs"
          >
            {rows.map((row, index) =>
              row.kind === "gap" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: une ligne n'a pas d'autre identité que sa place dans ce diff
                <span key={index} className="block text-text-muted">
                  <span className="sr-only">unchanged lines</span>
                  <span aria-hidden="true">…</span>
                </span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: une ligne n'a pas d'autre identité que sa place dans ce diff
                <Row key={index} row={row} />
              ),
            )}
          </pre>
          <p role="status" className="sr-only">
            {added} lines added, {removed} lines removed.
          </p>
        </figure>
      )}

      {writeFailure === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {renderMessage(writeFailure)}
        </p>
      )}

      <div className="sticky bottom-0 flex flex-wrap gap-1 bg-surface-1 py-1">
        <button
          type="submit"
          className={`${BUTTON} border-border-strong text-text-primary`}
          disabled={disabled || payload === null}
        >
          Insert into {pipeline.main}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function InsertTool(
  props: InsertToolProps & { open: boolean; onOpen: (open: boolean) => void },
) {
  const { open, onOpen, ...insertion } = props;
  const snippet = props.tool.snippets.gitlab;
  if (snippet === null) {
    return null;
  }
  return open ? (
    <Form {...insertion} snippet={snippet} onCancel={() => onOpen(false)} />
  ) : (
    <button
      type="button"
      className={`${BUTTON} self-start`}
      disabled={props.disabled}
      onClick={() => onOpen(true)}
    >
      Add to pipeline
    </button>
  );
}
