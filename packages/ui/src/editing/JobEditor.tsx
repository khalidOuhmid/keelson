import type { Job, Pipeline } from "@keelson/core";
import { useState } from "react";
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
  const candidates = pipeline.jobs
    .map((candidate) => candidate.id)
    .filter((id) => id !== job.id && !required.has(id));

  const [name, setName] = useState(job.id);
  const [needTarget, setNeedTarget] = useState(candidates[0] ?? "");
  const [optional, setOptional] = useState(false);
  const [artifacts, setArtifacts] = useState(true);
  const [environmentName, setEnvironmentName] = useState(job.environment?.value.name ?? "");
  const [environmentUrl, setEnvironmentUrl] = useState(job.environment?.value.url ?? "");

  const guard = (draft: Draft): void => {
    if (!disabled) {
      onSubmit(draft);
    }
  };

  return (
    <div className="flex flex-col gap-4 border-t border-border-subtle pt-3">
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

      <label className={GROUP}>
        <span className={LABEL}>Stage</span>
        <select
          className={FIELD}
          value={job.stage.value}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value !== job.stage.value) {
              guard(setJobStage(job.id, event.target.value));
            }
          }}
        >
          {pipeline.stages.map((stage) => (
            <option key={stage.name} value={stage.name}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>

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
            value={needTarget}
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

        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={optional}
            disabled={disabled}
            onChange={(event) => setOptional(event.target.checked)}
          />
          Optional
        </label>

        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={artifacts}
            disabled={disabled}
            onChange={(event) => setArtifacts(event.target.checked)}
          />
          Artifacts
        </label>

        <button
          type="button"
          className={BUTTON}
          disabled={disabled || needTarget === ""}
          onClick={() => guard(addNeed(job.id, needTarget, { optional, artifacts }))}
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
        type="button"
        className={DANGER_BUTTON}
        disabled={disabled}
        onClick={() => guard(removeJob(job.id))}
      >
        Delete job
      </button>
    </div>
  );
}
