import type { Job } from "@keelson/core";
import { useEffect, useRef, useState } from "react";
import { FIELD } from "../../editing/controls.ts";

const LISTBOX_ID = "job-search-results";

/** Prefix matches before inner matches, each group in file order. */
export function matchJobs(jobs: readonly Job[], query: string): Job[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...jobs];
  }
  const prefix = jobs.filter((job) => job.id.toLowerCase().startsWith(needle));
  const inner = jobs.filter(
    (job) => !job.id.toLowerCase().startsWith(needle) && job.id.toLowerCase().includes(needle),
  );
  return [...prefix, ...inner];
}

export type JobSearchProps = {
  jobs: readonly Job[];
  onPick: (id: string) => void;
  onClose: () => void;
};

/** A band under the header, in the flow like every other surface: a combobox over the job ids.
 *  It covers nothing, so it does not trap focus; Escape closes it. */
export function JobSearch({ jobs, onPick, onClose }: JobSearchProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement | null>(null);
  const found = matchJobs(jobs, query);
  const current = found[Math.min(active, found.length - 1)];

  useEffect(() => {
    field.current?.focus();
  }, []);

  const optionId = (id: string): string => `${LISTBOX_ID}-${id}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a search band is a named group, not a landmark among the header's
    <div
      role="group"
      aria-label="Job search"
      className="flex max-h-1/3 shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-border-subtle bg-surface-1 px-3 py-1.5"
    >
      <input
        ref={field}
        role="combobox"
        aria-label="Find a job"
        aria-expanded="true"
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={current === undefined ? undefined : optionId(current.id)}
        placeholder="Job name"
        className={FIELD}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive(Math.max(0, Math.min(found.length - 1, active + step)));
          } else if (event.key === "Enter" && current !== undefined) {
            event.preventDefault();
            onPick(current.id);
          }
        }}
      />
      {found.length === 0 ? (
        <p role="status" className="text-sm text-text-muted">
          No job matches {query.trim()}.
        </p>
      ) : null}
      <div id={LISTBOX_ID} role="listbox" aria-label="Jobs" className="flex flex-col">
        {found.map((job) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox field carries the keyboard; an option is only ever clicked
          <div
            key={job.id}
            id={optionId(job.id)}
            role="option"
            tabIndex={-1}
            aria-selected={job.id === current?.id}
            data-job={job.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(job.id)}
            className="flex min-h-6 cursor-pointer items-center justify-between gap-2 rounded-sm px-1.5 text-sm text-text-secondary transition-colors duration-fast ease-out hover:bg-surface-2 aria-selected:bg-surface-3 aria-selected:text-text-primary"
          >
            <span className="truncate font-mono text-xs">{job.id}</span>
            <span className="shrink-0 font-mono text-2xs text-text-muted">{job.stage.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
