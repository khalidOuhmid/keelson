import type { Tool } from "@keelson/catalog";
import {
  INTEGRATION_KINDS,
  type IntegrationKind,
  type Service,
  type Toolchain,
} from "@keelson/core";
import { useState } from "react";
import {
  BUTTON,
  DANGER_BUTTON,
  FIELD,
  GROUP,
  LABEL,
  SECTION_HEADING,
} from "../../editing/controls.ts";
import type { ToolchainDraft } from "../../state/toolchain.ts";

export type ServicePanelProps = {
  service: Service;
  toolchain: Toolchain;
  tool: Tool | undefined;
  jobs: readonly string[];
  disabled: boolean;
  onSubmit: (draft: ToolchainDraft) => void;
  onClose: () => void;
};

export function ServicePanel({
  service,
  toolchain,
  tool,
  jobs,
  disabled,
  onSubmit,
  onClose,
}: ServicePanelProps) {
  const [url, setUrl] = useState(service.url ?? "");
  const [environment, setEnvironment] = useState(service.environment ?? "");
  const [picked, setPicked] = useState(jobs[0] ?? "");
  // Un job peut quitter le pipeline, panneau ouvert : il ne doit pas être écrit pour autant.
  const job = jobs.includes(picked) ? picked : (jobs[0] ?? "");
  const [kind, setKind] = useState<IntegrationKind>(tool?.integration ?? "push");

  const linked = toolchain.integrations.filter((entry) => entry.service === service.id);
  const referencing = [...new Set(linked.map((entry) => entry.job))];

  return (
    <section
      aria-label="Service detail"
      className="flex min-h-full flex-col gap-4 border-l border-border-subtle bg-surface-1 p-3"
    >
      <header className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 truncate text-lg font-semibold text-text-primary">{service.id}</h2>
        <button
          type="button"
          aria-label="Close service detail"
          onClick={onClose}
          className={`shrink-0 ${BUTTON}`}
        >
          Close
        </button>
      </header>

      <p className="text-sm text-text-secondary">{tool?.name ?? service.tool}</p>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            kind: "updateService",
            id: service.id,
            url: url === "" ? null : url,
            environment: environment === "" ? null : environment,
          });
        }}
      >
        <label className={GROUP}>
          <span className={LABEL}>URL</span>
          <input
            className={FIELD}
            value={url}
            disabled={disabled}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className={GROUP}>
          <span className={LABEL}>Environment</span>
          <input
            className={FIELD}
            value={environment}
            disabled={disabled}
            onChange={(event) => setEnvironment(event.target.value)}
          />
        </label>
        <button type="submit" className={`${BUTTON} self-start`} disabled={disabled}>
          Save
        </button>
      </form>

      {/* biome-ignore lint/a11y/useSemanticElements: chaque liste est un groupe nommé, pas un repère ; fieldset est réservé aux formulaires */}
      <div role="group" aria-label="Integrations" className="flex flex-col gap-2">
        <h3 className={SECTION_HEADING}>Integrations</h3>
        {linked.length === 0 ? (
          <p className="text-sm text-text-muted">No job is integrated with this service.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {linked.map((entry) => (
              <li
                key={`${entry.job}:${entry.kind}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate text-sm text-text-secondary">
                  <span className="font-mono text-xs">{entry.job}</span> {entry.kind}
                </span>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={disabled}
                  aria-label={`Remove ${entry.kind} from ${entry.job}`}
                  onClick={() =>
                    onSubmit({
                      kind: "removeIntegration",
                      job: entry.job,
                      service: service.id,
                      integration: entry.kind,
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {jobs.length === 0 ? null : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit({
                kind: "addIntegration",
                job,
                service: service.id,
                integration: kind,
              });
            }}
          >
            <label className={`${GROUP} min-w-40 flex-1`}>
              <span className={LABEL}>Job</span>
              <select
                className={FIELD}
                value={job}
                disabled={disabled}
                onChange={(event) => setPicked(event.target.value)}
              >
                {jobs.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${GROUP} min-w-40 flex-1`}>
              <span className={LABEL}>Type</span>
              <select
                className={FIELD}
                value={kind}
                disabled={disabled}
                onChange={(event) => setKind(event.target.value as IntegrationKind)}
              >
                {INTEGRATION_KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={BUTTON} disabled={disabled}>
              Add integration
            </button>
          </form>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          className={`${DANGER_BUTTON} self-start`}
          disabled={disabled || referencing.length > 0}
          aria-describedby={referencing.length === 0 ? undefined : "service-in-use"}
          onClick={() => onSubmit({ kind: "removeService", id: service.id })}
        >
          Remove service
        </button>
        {referencing.length === 0 ? null : (
          <p id="service-in-use" className="text-sm text-text-muted">
            Still used by {referencing.join(", ")}.
          </p>
        )}
      </div>
    </section>
  );
}
