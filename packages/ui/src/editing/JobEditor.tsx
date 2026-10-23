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

export const JOB_LOCK_ID = "job-editor-locked";

export function jobLockNote(file: string): string {
  return `Editing is off for this job. It is defined in ${file}, and Keelson never writes to included files.`;
}

export type JobEditorProps = {
  job: Job;
  pipeline: Pipeline;
  onSubmit: (draft: Draft) => void;
  disabled?: boolean;
  /** Le fichier inclus qui possède le job, ou `null` s'il vit dans le fichier principal. Non nul
   *  ⇒ tous les contrôles sont désactivés, et la raison est portée par le groupe. */
  lockedTo?: string | null;
};

export function JobEditor({
  job,
  pipeline,
  onSubmit,
  disabled = false,
  lockedTo = null,
}: JobEditorProps) {
  const needs = job.needs?.value ?? [];
  const required = new Set(needs.map((need) => need.job));
  const candidates = pipeline.jobs
    .map((candidate) => candidate.id)
    .filter((id) => id !== job.id && !required.has(id));

  const [name, setName] = useState(job.id);
  const [needTarget, setNeedTarget] = useState(candidates[0] ?? "");
  // `candidates` se recalcule a chaque rendu, mais le composant n'est recle que sur `job.id` :
  // apres un ajout, la cible choisie quitte la liste et le navigateur affiche l'option 0 pendant
  // que l'etat garde l'ancienne. On soumet donc ce que le selecteur montre, jamais autre chose.
  const effectiveNeed = candidates.includes(needTarget) ? needTarget : (candidates[0] ?? "");
  const [optional, setOptional] = useState(false);
  const [artifacts, setArtifacts] = useState(true);
  const referencedBy = pipeline.jobs
    .filter((candidate) => (candidate.needs?.value ?? []).some((need) => need.job === job.id))
    .map((candidate) => candidate.id);

  const [stage, setStage] = useState(job.stage.value);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  // Le focus entre dans le dialogue a l'ouverture et revient au declencheur a la fermeture : sans
  // cela, la question posee n'est jamais atteinte par un lecteur d'ecran, et le focus retombe sur
  // <body> au moment le plus destructeur du produit.
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

  const locked = lockedTo !== null;
  const off = disabled || locked;

  const guard = (draft: Draft): void => {
    if (!off) {
      onSubmit(draft);
    }
  };

  return (
    /* La raison est portée par le **groupe** et non par chaque contrôle, parce qu'un contrôle
       `disabled` n'est pas tabulable. Mesuré : le groupe verrouillé a **zéro** arrêt de
       tabulation. Le groupe ne l'est pas davantage, donc cet `aria-describedby` ne s'expose qu'en
       mode exploration — il n'achète rien en tabulation, et prétendre le contraire serait
       surestimer. Ce qui porte réellement l'information est le `<p>` visible ci-dessous, en flux
       de lecture. L'attribut reste parce qu'il rattache la phrase au groupe en exploration, où
       l'ordre de lecture seul ne le dirait pas. On ne passe pas en `aria-disabled` focusable :
       quinze arrêts morts coûteraient plus qu'ils ne rapportent. */
    // biome-ignore lint/a11y/useSemanticElements: fieldset est réservé aux contrôles d'un seul formulaire ; ce bloc en contient plusieurs
    <div
      role="group"
      aria-label="Job editor"
      {...(locked ? { "aria-describedby": JOB_LOCK_ID } : {})}
      className="flex flex-col gap-4 border-t border-border-subtle pt-3"
    >
      {/* `sticky` : mesuré, le groupe des contrôles verrouillés commence sous le pli de la
          colonne de droite, donc la note et les quinze contrôles morts n'étaient jamais visibles
          ensemble. On défilait, on tombait sur l'interface morte, et l'explication avait disparu
          vers le haut. */}
      {lockedTo === null ? null : (
        <p
          id={JOB_LOCK_ID}
          className="sticky top-0 z-10 bg-surface-1 py-1 text-sm text-text-secondary"
        >
          {jobLockNote(lockedTo)}
        </p>
      )}
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
            disabled={off}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" className={BUTTON} disabled={off}>
          Rename
        </button>
      </form>

      <div className={GROUP}>
        <label className={GROUP}>
          <span className={LABEL}>Stage</span>
          <select
            className={FIELD}
            value={stage}
            disabled={off}
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
          disabled={off || stage === job.stage.value}
          onClick={() => {
            if (stage !== job.stage.value) {
              guard(setJobStage(job.id, stage));
            }
          }}
        >
          Move to stage
        </button>
      </div>

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
                  disabled={off}
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
            disabled={off || candidates.length === 0}
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
            disabled={off}
            onChange={(event) => setOptional(event.target.checked)}
          />
          Optional
        </label>

        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={artifacts}
            disabled={off}
            onChange={(event) => setArtifacts(event.target.checked)}
          />
          Artifacts
        </label>

        <button
          type="button"
          className={BUTTON}
          disabled={off || effectiveNeed === ""}
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
            disabled={off}
            onChange={(event) => setEnvironmentName(event.target.value)}
          />
        </label>
        <label className={GROUP}>
          <span className={LABEL}>Environment url</span>
          <input
            className={FIELD}
            value={environmentUrl}
            disabled={off}
            onChange={(event) => setEnvironmentUrl(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={BUTTON}
          disabled={off}
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
            disabled={off}
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
        disabled={off}
        onClick={() => setConfirmingDelete(true)}
      >
        Delete job
      </button>

      {confirmingDelete ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Delete ${job.id}`}
          // Echap annule le dialogue, pas le panneau : sans `stopPropagation`, l'ecouteur de
          // document d'app.tsx refermerait tout le panneau de detail au lieu de repondre.
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
              disabled={off}
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
