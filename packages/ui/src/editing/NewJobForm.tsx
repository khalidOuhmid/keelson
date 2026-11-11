import type { Pipeline } from "@keelson/core";
import { useState } from "react";
import type { Draft } from "../state/store.ts";
import { BUTTON, FIELD, GROUP, LABEL } from "./controls.ts";
import { addJob, scriptLines } from "./drafts.ts";

export type NewJobFormProps = {
  pipeline: Pipeline;
  onSubmit: (draft: Draft) => void;
  disabled?: boolean;
};

export function NewJobForm({ pipeline, onSubmit, disabled = false }: NewJobFormProps) {
  const first = pipeline.stages[0]?.name ?? "";
  const [id, setId] = useState("");
  const [stage, setStage] = useState(first);
  const [script, setScript] = useState("");

  const submit = (): void => {
    if (disabled || id.trim() === "" || scriptLines(script).length === 0) {
      return;
    }
    onSubmit(addJob({ id: id.trim(), stage, script }));
    setId("");
    setScript("");
  };

  return (
    <form
      className={GROUP}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className={GROUP}>
        <span className={LABEL}>New job id</span>
        <input
          className={FIELD}
          value={id}
          disabled={disabled}
          onChange={(event) => setId(event.target.value)}
        />
      </label>

      {/* A workflow has no stages: the order comes from `needs` (ADR 0013). */}
      {pipeline.provider === "github" ? null : (
        <label className={GROUP}>
          <span className={LABEL}>New job stage</span>
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
      )}

      <label className={GROUP}>
        <span className={LABEL}>Script</span>
        <textarea
          className={FIELD}
          rows={3}
          value={script}
          disabled={disabled}
          onChange={(event) => setScript(event.target.value)}
        />
      </label>

      <button type="submit" className={BUTTON} disabled={disabled}>
        Create job
      </button>
    </form>
  );
}
