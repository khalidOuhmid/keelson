import type { Tool } from "@keelson/catalog";
import type { ProposedIntegration } from "@keelson/toolchain";
import { useEffect, useRef, useState } from "react";
import type { ToolchainPayload } from "../../api/client.ts";
import { BUTTON, FIELD, GROUP, LABEL, SECTION_HEADING } from "../../editing/controls.ts";
import { overlaysCover } from "../../focus.ts";
import { ChevronRightIcon } from "../../icons.tsx";
import type { ToolchainDraft } from "../../state/toolchain.ts";

type Submit = (draft: ToolchainDraft) => unknown;

export type ToolchainPanelProps = {
  payload: ToolchainPayload;
  tools: readonly Tool[];
  disabled: boolean;
  /** `toolchain.yaml` unreadable: an empty list there would be a false statement. */
  invalid?: boolean;
  selectedService: string | null;
  onSubmit: Submit;
  onSelectService: (id: string) => void;
};

function nameOf(tools: readonly Tool[], id: string): string {
  return tools.find((tool) => tool.id === id)?.name ?? id;
}

function Proposal({
  entry,
  tools,
  disabled,
  onSubmit,
  onAddService,
}: {
  entry: ProposedIntegration;
  tools: readonly Tool[];
  disabled: boolean;
  onSubmit: Submit;
  onAddService: (tool: string) => void;
}) {
  const [chosen, setChosen] = useState(entry.services[0] ?? "");
  const service = entry.services.includes(chosen) ? chosen : entry.services[0];
  const { job, tool, kind: integration } = entry;

  return (
    <li className="flex flex-col gap-1">
      <p className="text-sm text-text-primary">
        <span className="font-mono text-xs">{job}</span> {integration}{" "}
        <span className="text-text-secondary">{nameOf(tools, tool)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {entry.services.length > 1 ? (
          <select
            aria-label={`Service for ${job}`}
            className={`${FIELD} w-auto`}
            value={service}
            disabled={disabled}
            onChange={(event) => setChosen(event.target.value)}
          >
            {entry.services.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        ) : null}
        {service === undefined ? (
          <button
            type="button"
            className={BUTTON}
            disabled={disabled}
            aria-label={`Add a service for ${job}, ${nameOf(tools, tool)}`}
            onClick={() => onAddService(tool)}
          >
            Add service
          </button>
        ) : (
          <button
            type="button"
            className={BUTTON}
            disabled={disabled}
            aria-label={`Confirm ${integration} from ${job} to ${service}`}
            onClick={() => onSubmit({ kind: "addIntegration", job, service, integration })}
          >
            Confirm
          </button>
        )}
        <button
          type="button"
          className={BUTTON}
          disabled={disabled}
          aria-label={`Dismiss ${integration} from ${job} to ${nameOf(tools, tool)}`}
          onClick={() => onSubmit({ kind: "dismissIntegration", job, tool, integration })}
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}

function AddService({
  tools,
  tool,
  onTool,
  disabled,
  onSubmit,
  nameField,
}: {
  tools: readonly Tool[];
  tool: string;
  onTool: (id: string) => void;
  disabled: boolean;
  onSubmit: Submit;
  nameField: React.RefObject<HTMLInputElement | null>;
}) {
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [environment, setEnvironment] = useState("");
  const chosen = tool === "" ? (tools[0]?.id ?? "") : tool;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          const written = await onSubmit({
            kind: "addService",
            id: id === "" ? chosen : id,
            tool: chosen,
            url: url === "" ? null : url,
            environment: environment === "" ? null : environment,
          });
          if (written !== false) {
            setId("");
            setUrl("");
            setEnvironment("");
          }
        })();
      }}
    >
      <label className={GROUP}>
        <span className={LABEL}>Tool</span>
        <select
          className={FIELD}
          value={chosen}
          disabled={disabled}
          onChange={(event) => onTool(event.target.value)}
        >
          {tools.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label className={GROUP}>
        <span className={LABEL}>Name</span>
        <input
          ref={nameField}
          className={FIELD}
          value={id}
          placeholder={chosen}
          disabled={disabled}
          onChange={(event) => setId(event.target.value)}
        />
      </label>
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
        Add service
      </button>
    </form>
  );
}

export function ToolchainPanel({
  payload,
  tools,
  disabled,
  invalid = false,
  selectedService,
  onSubmit,
  onSelectService,
}: ToolchainPanelProps) {
  const { toolchain, proposed } = payload;
  const [tool, setTool] = useState("");
  const nameField = useRef<HTMLInputElement>(null);
  const services = tools.filter((entry) => entry.kind === "service");
  // Below `lg` the panel is a full-screen overlay: the form would push the proposals off it.
  const [adding, setAdding] = useState(() => !overlaysCover());
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (asked > 0) {
      nameField.current?.focus();
    }
  }, [asked]);

  if (invalid) {
    return (
      <p className="text-sm text-text-secondary">
        toolchain.yaml can't be read. Editing is off; see Diagnostics.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* biome-ignore lint/a11y/useSemanticElements: each list is a named group, not a landmark; fieldset is reserved for forms */}
      <div role="group" aria-label="Proposed integrations" className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>
          Proposed integrations{" "}
          {proposed.length === 0 ? null : (
            <span className="font-mono text-xs text-text-muted">{proposed.length}</span>
          )}
        </h2>
        {proposed.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing to confirm.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {proposed.map((entry) => (
              <Proposal
                key={`${entry.job}:${entry.tool}:${entry.kind}`}
                entry={entry}
                tools={tools}
                disabled={disabled}
                onSubmit={onSubmit}
                onAddService={(id) => {
                  setTool(id);
                  setAdding(true);
                  setAsked((count) => count + 1);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: each list is a named group, not a landmark; fieldset is reserved for forms */}
      <div role="group" aria-label="Services" className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>Services</h2>
        {toolchain.services.length === 0 ? (
          <p className="text-sm text-text-muted">No services declared yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {toolchain.services.map((service) => (
              <li key={service.id}>
                <button
                  type="button"
                  aria-current={service.id === selectedService ? "true" : undefined}
                  onClick={() => onSelectService(service.id)}
                  className="flex w-full cursor-pointer flex-col rounded-sm border border-transparent px-1 py-1 text-left transition-colors duration-fast ease-out hover:bg-surface-3 aria-[current=true]:border-accent"
                >
                  <span className="truncate text-sm text-text-primary">{service.id}</span>
                  <span className="truncate text-xs text-text-muted">
                    {nameOf(tools, service.tool)}
                    {service.environment === null ? "" : ` · ${service.environment}`}
                  </span>
                  {toolchain.integrations
                    .filter((entry) => entry.service === service.id)
                    .map((entry) => (
                      <span
                        key={`${entry.job}:${entry.kind}`}
                        className="truncate font-mono text-2xs text-text-muted"
                      >
                        {entry.job} {entry.kind}
                      </span>
                    ))}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: each list is a named group, not a landmark; fieldset is reserved for forms */}
      <div role="group" aria-label="New service" className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>
          <button
            type="button"
            aria-expanded={adding}
            aria-controls="new-service-form"
            onClick={() => setAdding(!adding)}
            className="group flex min-h-6 cursor-pointer items-center gap-1"
          >
            <ChevronRightIcon className="transition-transform duration-fast ease-out group-aria-expanded:rotate-90" />
            New service
          </button>
        </h2>
        {adding ? (
          <div id="new-service-form">
            <AddService
              tools={services}
              tool={tool}
              onTool={setTool}
              disabled={disabled}
              onSubmit={onSubmit}
              nameField={nameField}
            />
          </div>
        ) : null}
      </div>

      {toolchain.dismissed.length === 0 ? null : (
        // biome-ignore lint/a11y/useSemanticElements: each list is a named group, not a landmark; fieldset is reserved for forms
        <div role="group" aria-label="Dismissed" className="flex flex-col gap-2">
          <h2 className={SECTION_HEADING}>Dismissed</h2>
          <ul className="flex flex-col gap-1">
            {toolchain.dismissed.map(({ job, tool: dismissed, kind: integration }) => (
              <li
                key={`${job}:${dismissed}:${integration}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate text-sm text-text-secondary">
                  <span className="font-mono text-xs">{job}</span> {integration}{" "}
                  {nameOf(tools, dismissed)}
                </span>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={disabled}
                  aria-label={`Restore ${integration} from ${job} to ${nameOf(tools, dismissed)}`}
                  onClick={() =>
                    onSubmit({ kind: "restoreIntegration", job, tool: dismissed, integration })
                  }
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
