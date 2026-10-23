import type { Pipeline } from "@keelson/core";
import { useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons.tsx";
import type { Draft } from "../state/store.ts";
import { BUTTON, FIELD, GROUP, LABEL } from "./controls.ts";
import { addStage, moveStage } from "./drafts.ts";

export const STAGE_LOCK_ID = "stage-controls-locked";

export function stageLockNote(file: string): string {
  return `The stage list is defined in ${file}, an included file. Keelson never writes to included files, so stages cannot be added or reordered here.`;
}

/** Le fichier qui déclare la liste `stages`, ou `null` si c'est le fichier principal. Une liste
 *  écrase et ne fusionne pas : elle vient donc d'un seul fichier, et le premier stage suffit à le
 *  nommer. Les stages implicites portent le fichier principal, donc une liste absente reste
 *  matérialisable. */
export function stagesLockedTo(pipeline: Pipeline): string | null {
  const foreign = pipeline.stages.find((stage) => stage.file !== pipeline.main);
  return foreign?.file ?? null;
}

export type StageControlsProps = {
  pipeline: Pipeline;
  onSubmit: (draft: Draft) => void;
  disabled?: boolean;
};

const END = "end";

export function StageControls({ pipeline, onSubmit, disabled = false }: StageControlsProps) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState(END);
  const lockedTo = stagesLockedTo(pipeline);
  const off = disabled || lockedTo !== null;

  const guard = (draft: Draft): void => {
    if (!off) {
      onSubmit(draft);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {lockedTo === null ? null : (
        <p id={STAGE_LOCK_ID} className="text-sm text-text-secondary">
          {stageLockNote(lockedTo)}
        </p>
      )}
      <form
        className={GROUP}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") {
            return;
          }
          guard(
            position === END
              ? addStage(name.trim())
              : addStage(name.trim(), Number.parseInt(position, 10)),
          );
          setName("");
        }}
      >
        <label className={GROUP}>
          <span className={LABEL}>New stage name</span>
          <input
            className={FIELD}
            value={name}
            disabled={off}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className={GROUP}>
          <span className={LABEL}>Insert at</span>
          <select
            className={FIELD}
            value={position}
            disabled={off}
            onChange={(event) => setPosition(event.target.value)}
          >
            <option value={END}>end</option>
            {pipeline.stages.map((stage, index) => (
              <option key={stage.name} value={String(index)}>
                before {stage.name}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className={BUTTON} disabled={off}>
          Add stage
        </button>
      </form>

      <div className={GROUP}>
        <span className={LABEL}>Stage order</span>
        <ul className="flex flex-col gap-1">
          {pipeline.stages.map((stage, index) => (
            <li key={stage.name} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-text-secondary">{stage.name}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className={BUTTON}
                  disabled={off || index === 0}
                  aria-label={`Move ${stage.name} earlier`}
                  onClick={() => guard(moveStage(stage.name, index - 1))}
                >
                  <ArrowLeftIcon />
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={off || index === pipeline.stages.length - 1}
                  aria-label={`Move ${stage.name} later`}
                  onClick={() => guard(moveStage(stage.name, index + 1))}
                >
                  <ArrowRightIcon />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
