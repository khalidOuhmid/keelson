import type { Tool } from "@keelson/catalog";
import type { Pipeline } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import type { LayerId } from "@keelson/taxonomy";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiFailure, ApiResult, OperationPayload } from "../../api/client.ts";
import { BUTTON, FIELD, GROUP, LABEL } from "../../editing/controls.ts";
import { diffRows, visibleRows } from "../../editing/diff.ts";
import type { Draft } from "../../state/store.ts";
import { LayerTags } from "../coverage/LayerTag.tsx";

export type Insertion = {
  pipeline: Pipeline;
  text: string;
  disabled: boolean;
  preview: (draft: Draft) => Promise<ApiResult<OperationPayload>>;
  /** `job` est sélectionné une fois l'écriture faite. */
  onInsert: (draft: Draft, job: string) => Promise<boolean>;
};

export type InsertToolProps = Insertion & { tool: Tool };

const SIGN = { same: " ", add: "+", remove: "-" } as const;

const ROW = {
  same: "text-text-muted",
  add: "text-text-primary bg-accent/10",
  remove: "text-danger bg-danger-muted/20",
} as const;

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
  return /^[ \t]+stage:[ \t]*["']?([^"'\s#]+)/m.exec(snippet)?.[1] ?? null;
}

function draftFor(id: string, stage: string, snippet: string, pipeline: Pipeline): Draft {
  const add = { kind: "addSnippet", id, stage, snippet } as const;
  return pipeline.stages.some((entry) => entry.name === stage)
    ? add
    : { kind: "composite", steps: [{ kind: "addStage", name: stage }, add] };
}

type Result = { payload: OperationPayload } | { failure: ApiFailure };

function Form({
  tool,
  snippet,
  pipeline,
  text,
  disabled,
  preview,
  onInsert,
}: InsertToolProps & { snippet: string }) {
  const taken = useMemo(
    () => new Set([...pipeline.jobs, ...pipeline.templates].map((entry) => entry.id)),
    [pipeline],
  );
  const stages = pipeline.stages.map((stage) => stage.name);
  const wanted = snippetStage(snippet);
  const created = wanted !== null && !stages.includes(wanted) ? wanted : null;

  const [id, setId] = useState(() => freeName(tool.id, taken));
  const [stage, setStage] = useState(wanted ?? stages[0] ?? "test");
  const [result, setResult] = useState<Result | null>(null);
  const asked = useRef(0);

  const draft = useMemo(
    () => draftFor(id, stage, snippet, pipeline),
    [id, stage, snippet, pipeline],
  );

  useEffect(() => {
    asked.current += 1;
    const turn = asked.current;
    void preview(draft).then((answer) => {
      if (turn === asked.current) {
        setResult(answer.ok ? { payload: answer.value } : { failure: answer.error });
      }
    });
  }, [draft, preview]);

  const rows =
    result !== null && "payload" in result
      ? visibleRows(diffRows(text, result.payload.text), 2)
      : [];
  const layers: readonly LayerId[] =
    result !== null && "payload" in result
      ? (result.payload.coverage.jobs.find((job) => job.job === id)?.layers ?? [])
      : [];

  return (
    <div className="flex flex-col gap-2">
      <label className={GROUP}>
        <span className={LABEL}>Job name</span>
        <input
          className={FIELD}
          value={id}
          disabled={disabled}
          onChange={(event) => setId(event.target.value)}
        />
      </label>
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

      {result !== null && "failure" in result ? (
        <p role="alert" className="text-sm text-danger">
          {renderMessage(result.failure)}
        </p>
      ) : null}

      {layers.length === 0 ? null : (
        <p data-testid="insert-layers" className="flex flex-wrap items-center gap-1 text-sm">
          <span className="text-text-muted">Covers</span>
          <LayerTags layers={layers} />
        </p>
      )}

      {rows.length === 0 ? null : <h3 className={LABEL}>Changes</h3>}
      {rows.length === 0 ? null : (
        <pre
          data-testid="insert-diff"
          className="overflow-x-auto rounded-sm border border-border-default bg-surface-inset p-1 font-mono text-xs"
        >
          {rows.map((row, index) =>
            row.kind === "gap" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: une ligne n'a pas d'autre identité que sa place dans ce diff
              <span key={index} className="block text-text-muted">
                …
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: une ligne n'a pas d'autre identité que sa place dans ce diff
              <span key={index} className={`block ${ROW[row.kind]}`}>
                {SIGN[row.kind]}
                {row.text}
              </span>
            ),
          )}
        </pre>
      )}

      <button
        type="button"
        className={`${BUTTON} self-start`}
        disabled={disabled || result === null || "failure" in result}
        onClick={() => void onInsert(draft, id)}
      >
        Insert
      </button>
    </div>
  );
}

export function InsertTool(props: InsertToolProps) {
  const [open, setOpen] = useState(false);
  const snippet = props.tool.snippets.gitlab;
  if (snippet === null) {
    return null;
  }
  return open ? (
    <Form {...props} snippet={snippet} />
  ) : (
    <button
      type="button"
      className={`${BUTTON} self-start`}
      disabled={props.disabled}
      onClick={() => setOpen(true)}
    >
      Add to pipeline
    </button>
  );
}
