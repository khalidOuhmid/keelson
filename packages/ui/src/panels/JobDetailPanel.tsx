import type { Job, Origin } from "@keelson/core";
import { OriginBadge } from "../views/pipeline/OriginBadge.tsx";
import { OpaqueBlockView } from "./OpaqueBlockView.tsx";
import { sliceOpaque } from "./opaque.ts";

export type JobDetailPanelProps = {
  job: Job;
  text: string;
  onClose: () => void;
};

function Field({
  label,
  testId,
  origin,
  children,
}: {
  label: string;
  testId?: string;
  origin?: Origin | null;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId} className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 text-2xs font-semibold tracking-label text-text-muted uppercase">
        {label}
        {origin == null ? null : <OriginBadge origin={origin} />}
      </h3>
      <div className="text-sm text-text-secondary">{children}</div>
    </section>
  );
}

export function JobDetailPanel({ job, text, onClose }: JobDetailPanelProps) {
  const needs = job.needs?.value ?? [];
  const environment = job.environment?.value ?? null;

  return (
    <section
      aria-label="Job detail"
      className="flex h-full flex-col gap-4 overflow-y-auto border-l border-border-subtle bg-surface-1 p-3"
    >
      <header className="flex items-start justify-between gap-2">
        <h2 className="truncate text-lg font-semibold text-text-primary">{job.id}</h2>
        <button
          type="button"
          aria-label="Close job detail"
          className="shrink-0 cursor-pointer rounded-sm border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors duration-fast ease-out hover:bg-surface-3"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <Field label="Stage" testId="job-stage" origin={job.stage.origin}>
        <span className="font-mono">{job.stage.value}</span>
      </Field>

      <Field label="Needs" testId="job-needs" origin={job.needs?.origin ?? null}>
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

      <Field label="Environment" testId="job-environment" origin={job.environment?.origin ?? null}>
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
              <OpaqueBlockView blockKey={block.key} source={sliceOpaque(text, block)} />
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
