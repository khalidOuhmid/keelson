import type { JobCoverage } from "@keelson/catalog";
import type { Job, Origin } from "@keelson/core";
import { LayerTags } from "../views/coverage/LayerTag.tsx";
import { ReadOnlyTag } from "../views/pipeline/JobNode.tsx";
import { OriginBadge } from "../views/pipeline/OriginBadge.tsx";
import { OpaqueBlockView } from "./OpaqueBlockView.tsx";
import { sliceOpaque } from "./opaque.ts";

export const INCLUDED_JOB_NOTE =
  "This job is defined in an included file. Keelson never writes to included files, so it cannot be edited here. Open that file in your own editor to change it.";

const INCLUDED_NOTE_ID = "job-included-reason";

export type JobDetailPanelProps = {
  job: Job;
  /** Le texte du fichier d'un bloc opaque. Un seul `text` ne suffit plus : les plages d'un job
   *  inclus sont des offsets dans **son** fichier, et les découper dans le fichier principal
   *  rendrait des octets pris ailleurs. */
  textOf: (file: string) => string;
  /** Le fichier principal, pour savoir si ce job est éditable. */
  main: string;
  /** Sur la vue Coverage : ce qui a décidé des couches de ce job. */
  coverage?: JobCoverage | null;
  onClose: () => void;
};

function Field({
  label,
  testId,
  origin,
  readOnly = false,
  children,
}: {
  label: string;
  testId?: string;
  origin?: Origin | null;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId} className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 text-2xs font-semibold tracking-label text-text-muted uppercase">
        {label}
        {origin == null ? null : <OriginBadge origin={origin} readOnly={readOnly} />}
      </h3>
      <div className="text-sm text-text-secondary">{children}</div>
    </section>
  );
}

function OpaqueContent({ blockKey, source }: { blockKey: string; source: string | null }) {
  if (source === null) {
    return (
      <p className="rounded-md border border-border-default bg-surface-2 p-2.5 text-xs text-text-secondary">
        Content unavailable — Keelson cannot read this range of the file. The block is still on disk
        and untouched; reopening the file usually resolves it.
      </p>
    );
  }
  return <OpaqueBlockView blockKey={blockKey} source={source} />;
}

export function JobDetailPanel({
  job,
  textOf,
  main,
  coverage = null,
  onClose,
}: JobDetailPanelProps) {
  const needs = job.needs?.value ?? [];
  const environment = job.environment?.value ?? null;
  const included = job.file !== main;

  return (
    <section
      aria-label="Job detail"
      {...(included ? { "aria-describedby": INCLUDED_NOTE_ID } : {})}
      className="flex h-full flex-col gap-4 overflow-y-auto border-l border-border-subtle bg-surface-1 p-3"
    >
      <header className="flex items-start justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-lg font-semibold text-text-primary">
          <span className="truncate">{job.id}</span>
          {included ? <ReadOnlyTag /> : null}
        </h2>
        <button
          type="button"
          aria-label="Close job detail"
          className="shrink-0 cursor-pointer rounded-sm border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors duration-fast ease-out hover:bg-surface-3"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      {included ? (
        <p id={INCLUDED_NOTE_ID} className="text-sm text-text-secondary">
          {INCLUDED_JOB_NOTE}
        </p>
      ) : null}

      {/* Seulement quand ce n'est pas le fichier principal, exactement la règle que
          `DiagnosticsPanel` applique déjà : l'en-tête de l'application affiche le fichier
          principal en permanence, donc le répéter en première position du panneau dépense la
          place la plus coûteuse de l'écran pour une tautologie. Les deux composants du lot avaient
          tranché la même question dans les deux sens. */}
      {included ? (
        <Field label="Source file" testId="job-source-file">
          <span className="font-mono break-all">{job.file}</span>
        </Field>
      ) : null}

      {coverage === null ? null : (
        <Field label="Layers" testId="job-layers">
          {coverage.layers.length === 0 ? (
            <p className="text-text-muted">No layer detected.</p>
          ) : (
            <p className="flex flex-wrap items-center gap-1.5">
              <LayerTags layers={coverage.layers} />
            </p>
          )}
          <p data-testid="job-layers-source" className="mt-1 text-xs text-text-muted">
            {coverage.overridden
              ? "Set by .devsecops/layout.json."
              : coverage.tools.length === 0
                ? "Keelson recognised no tool in this job."
                : `Detected from ${coverage.tools.join(", ")}.`}
          </p>
        </Field>
      )}

      <Field label="Stage" testId="job-stage" origin={job.stage.origin} readOnly={included}>
        <span className="font-mono">{job.stage.value}</span>
      </Field>

      <Field
        label="Needs"
        testId="job-needs"
        origin={job.needs?.origin ?? null}
        readOnly={included}
      >
        {needs.length === 0 ? (
          <p className="text-text-muted">No dependencies.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {needs.map((need) => (
              <li key={need.job} className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono">{need.job}</span>
                {need.optional ? <Tag>optional</Tag> : null}
                {need.artifacts ? null : <Tag>no artifacts</Tag>}
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field
        label="Environment"
        testId="job-environment"
        origin={job.environment?.origin ?? null}
        readOnly={included}
      >
        {environment === null ? (
          <p className="text-text-muted">None.</p>
        ) : (
          <dl className="flex flex-col gap-0.5">
            <Pair term="name" value={environment.name} />
            {environment.url === undefined ? null : <Pair term="url" value={environment.url} />}
            {environment.action === undefined ? null : (
              <Pair term="action" value={environment.action} />
            )}
          </dl>
        )}
      </Field>

      {job.extends.length === 0 ? null : (
        <Field label="Extends" testId="job-extends">
          <ul className="flex flex-wrap gap-1.5">
            {job.extends.map((template) => (
              <li key={template} className="font-mono">
                {template}
              </li>
            ))}
          </ul>
        </Field>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-2xs font-semibold tracking-label text-text-muted uppercase">
          Opaque blocks
        </h3>
        {job.opaque.length === 0 ? (
          <p className="text-sm text-text-muted">No opaque blocks.</p>
        ) : (
          job.opaque.map((block) => (
            // biome-ignore lint/a11y/useSemanticElements: fieldset est réservé aux contrôles de formulaire ; un bloc opaque est un groupe nommé, pas un landmark
            <div
              key={block.key}
              role="group"
              aria-label={`Opaque block ${block.key}`}
              className="flex flex-col gap-1"
            >
              <header className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-text-secondary">{block.key}</span>
                <span className="text-2xs tracking-label text-text-muted uppercase">read-only</span>
              </header>
              <OpaqueContent blockKey={block.key} source={sliceOpaque(textOf(block.file), block)} />
            </div>
          ))
        )}
      </section>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-border-default px-1 text-2xs tracking-label text-text-muted uppercase">
      {children}
    </span>
  );
}

function Pair({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="font-mono text-xs text-text-muted">{term}</dt>
      <dd className="font-mono text-xs break-all text-text-secondary">{value}</dd>
    </div>
  );
}
