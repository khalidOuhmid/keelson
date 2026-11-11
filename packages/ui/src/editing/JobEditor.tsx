import type { Job, Pipeline } from "@keelson/core";
import { useEffect, useRef, useState } from "react";
import type { Draft } from "../state/store.ts";
import { BUTTON, DANGER_BUTTON, FIELD, GROUP, LABEL } from "./controls.ts";
import {
  addNeed,
  removeJob,
  removeNeed,
  renameJob,
  setEnvironment,
  setJobStage,
} from "./drafts.ts";

export type JobEditorProps = {
  job: Job;
  pipeline: Pipeline;
  onSubmit: (draft: Draft) => void;
  disabled?: boolean;
};

export function JobEditor({ job, pipeline, onSubmit, disabled = false }: JobEditorProps) {
  const needs = job.needs?.value ?? [];
  const required = new Set(needs.map((need) => need.job));
  // A job that depends on this one would create a cycle: offering it would only lead to a refusal.
  const descendants = new Set<string>();
  const visit = (id: string): void => {
    for (const other of pipeline.jobs) {
      if (other.needs?.value.some((need) => need.job === id) && !descendants.has(other.id)) {
        descendants.add(other.id);
        visit(other.id);
      }
    }
  };
  visit(job.id);
  const candidates = pipeline.jobs
    .map((candidate) => candidate.id)
    .filter((id) => id !== job.id && !required.has(id) && !descendants.has(id));

  const [name, setName] = useState(job.id);
  const [needTarget, setNeedTarget] = useState(candidates[0] ?? "");
  // `candidates` is recomputed on every render, but the component is only remounted on `job.id`:
  // after an addition, the chosen target leaves the list and the browser shows option 0 while the
  // state keeps the old one. So we submit what the select shows, never anything else.
  const effectiveNeed = candidates.includes(needTarget) ? needTarget : (candidates[0] ?? "");
  const github = pipeline.provider === "github";
  const [optional, setOptional] = useState(false);
  const [artifacts, setArtifacts] = useState(true);
  const referencedBy = pipeline.jobs
    .filter((candidate) => (candidate.needs?.value ?? []).some((need) => need.job === job.id))
    .map((candidate) => candidate.id);

  const [stage, setStage] = useState(job.stage.value);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  // Focus moves into the dialog when it opens and back to the trigger when it closes: otherwise a
  // screen reader never reaches the question being asked, and focus falls back to <body> at the
  // most destructive moment in the product.
  useEffect(() => {
    if (confirmingDelete) {
      confirmButton.current?.focus();
    }
  }, [confirmingDelete]);

  const cancelDelete = (): void => {
    setConfirmingDelete(false);
    deleteTrigger.current?.focus();
  };
  const [environmentName, setEnvironmentName] = useState(job.environment?.value.name ?? "");
  const [environmentUrl, setEnvironmentUrl] = useState(job.environment?.value.url ?? "");

  const guard = (draft: Draft): void => {
    if (!disabled) {
      onSubmit(draft);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset is reserved for the controls of a single form; this block contains several
    <div
      role="group"
      aria-label="Job editor"
      className="flex flex-col gap-4 border-t border-border-subtle pt-3"
    >
      <form
        className={GROUP}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() !== "" && name.trim() !== job.id) {
            guard(renameJob(job.id, name.trim()));
          }
        }}
      >
        <label className={GROUP}>
          <span className={LABEL}>Job id</span>
          <input
            className={FIELD}
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" className={BUTTON} disabled={disabled}>
          Rename
        </button>
      </form>

      {github ? null : (
        <div className={GROUP}>
          <label className={GROUP}>
            <span className={LABEL}>Stage</span>
            <select
              className={FIELD}
              value={stage}
              disabled={disabled}
              onChange={(event) => setStage(event.target.value)}
            >
              {pipeline.stages.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={BUTTON}
            disabled={disabled || stage === job.stage.value}
            onClick={() => {
              if (stage !== job.stage.value) {
                guard(setJobStage(job.id, stage));
              }
            }}
          >
            Move to stage
          </button>
        </div>
      )}

      <div className={GROUP}>
        <span className={LABEL}>Needs</span>
        {needs.length === 0 ? null : (
          <ul className="flex flex-col gap-1">
            {needs.map((need) => (
              <li key={need.job} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-text-secondary">{need.job}</span>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={disabled}
                  aria-label={`Remove need ${need.job}`}
                  onClick={() => guard(removeNeed(job.id, need.job))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className={GROUP}>
          <span className={LABEL}>Add a need</span>
          <select
            className={FIELD}
            value={effectiveNeed}
            disabled={disabled || candidates.length === 0}
            onChange={(event) => setNeedTarget(event.target.value)}
          >
            {candidates.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>

        {github ? null : (
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={optional}
              disabled={disabled}
              onChange={(event) => setOptional(event.target.checked)}
            />
            Optional
          </label>
        )}

        {github ? null : (
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={artifacts}
              disabled={disabled}
              onChange={(event) => setArtifacts(event.target.checked)}
            />
            Artifacts
          </label>
        )}

        <button
          type="button"
          className={BUTTON}
          disabled={disabled || effectiveNeed === ""}
          onClick={() => guard(addNeed(job.id, effectiveNeed, { optional, artifacts }))}
        >
          Add need
        </button>
      </div>

      <div className={GROUP}>
        <span className={LABEL}>Environment</span>
        <label className={GROUP}>
          <span className={LABEL}>Environment name</span>
          <input
            className={FIELD}
            value={environmentName}
            disabled={disabled}
            onChange={(event) => setEnvironmentName(event.target.value)}
          />
        </label>
        <label className={GROUP}>
          <span className={LABEL}>Environment url</span>
          <input
            className={FIELD}
            value={environmentUrl}
            disabled={disabled}
            onChange={(event) => setEnvironmentUrl(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={BUTTON}
          disabled={disabled}
          onClick={() => {
            if (environmentName.trim() !== "") {
              guard(setEnvironment(job.id, { name: environmentName.trim(), url: environmentUrl }));
            }
          }}
        >
          Set environment
        </button>
        {job.environment === null ? null : (
          <button
            type="button"
            className={BUTTON}
            disabled={disabled}
            onClick={() => guard(setEnvironment(job.id, null))}
          >
            Remove environment
          </button>
        )}
      </div>

      <button
        ref={deleteTrigger}
        type="button"
        className={DANGER_BUTTON}
        disabled={disabled}
        onClick={() => setConfirmingDelete(true)}
      >
        Delete job
      </button>

      {confirmingDelete ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Delete ${job.id}`}
          // Escape cancels the dialog, not the panel: without `stopPropagation`, the document
          // listener in app.tsx would close the whole detail panel instead of answering.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              cancelDelete();
            }
          }}
          className={`${GROUP} rounded-md border border-border-default bg-surface-2 p-2.5`}
        >
          <p className="text-xs text-text-secondary">
            Delete <span className="font-mono text-text-primary">{job.id}</span> from the file?
            {referencedBy.length === 0
              ? " Nothing depends on it."
              : ` ${referencedBy.join(", ")} depend${referencedBy.length === 1 ? "s" : ""} on it.`}
          </p>
          <div className="flex gap-1.5">
            <button
              ref={confirmButton}
              type="button"
              className={DANGER_BUTTON}
              disabled={disabled}
              onClick={() => {
                setConfirmingDelete(false);
                guard(removeJob(job.id));
              }}
            >
              Delete {job.id}
            </button>
            <button type="button" className={BUTTON} onClick={cancelDelete}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
