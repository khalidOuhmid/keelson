import type { Pipeline, UnresolvedInclude } from "@keelson/core";
import { isPartial } from "@keelson/core";
import { ChevronRightIcon } from "../icons.tsx";

export const PARTIAL_HINT =
  "Some includes are not resolved, so jobs may be missing from this view.";

export const PARTIAL_WORKFLOW_HINT =
  "Some reusable workflows are not read, so jobs may be missing from this view.";

export function unresolvedCount(count: number): string {
  return `${count} unresolved ${count === 1 ? "include" : "includes"}`;
}

const workflowCount = (count: number): string =>
  `${count} reusable ${count === 1 ? "workflow" : "workflows"}`;

export type PartialPipelineBarProps = {
  pipeline: Pipeline;
};

/** Three things set it apart from `NoticeBar`, all three intentional: no severity tint — an
 *  unresolved include is a gap, not an error —, **no `Dismiss` button**, because a fact cannot be
 *  dismissed, and no live region, because this is not an event but a state of the file. */
export function PartialPipelineBar({ pipeline }: PartialPipelineBarProps) {
  if (!isPartial(pipeline)) {
    return null;
  }
  const github = pipeline.provider === "github";

  return (
    // biome-ignore lint/a11y/useSemanticElements: one more landmark would drown the landmark list; this block is a named group
    <div
      role="group"
      aria-label="Partial pipeline"
      className="max-h-1/3 shrink-0 overflow-y-auto border-b border-border-subtle bg-surface-1 px-3 py-1.5"
    >
      <details className="group">
        {/* `py-1.5` raises the target height from 20 px — measured — to 32 px. */}
        <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 py-1.5 text-sm text-text-secondary">
          <ChevronRightIcon className="transition-transform duration-fast ease-out group-open:rotate-90" />
          <span className="text-2xs font-semibold tracking-label text-text-muted uppercase">
            Partial pipeline
          </span>
          <span className="font-mono text-2xs text-text-muted tabular-nums">
            {(github ? workflowCount : unresolvedCount)(pipeline.unresolved.length)}
          </span>
          <span>{github ? PARTIAL_WORKFLOW_HINT : PARTIAL_HINT}</span>
        </summary>
        <ul className="mt-1.5 flex flex-col gap-1">
          {/* The key carries the range, not the index: GitLab does not deduplicate includes, so
              the same file can declare the same value twice, and only the position tells them
              apart. */}
          {pipeline.unresolved.map((entry) => (
            <li
              key={`${entry.from}:${entry.range?.start ?? "?"}:${entry.detail}`}
              className="flex flex-wrap items-center gap-1.5"
            >
              <Body entry={entry} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** No entry is clickable. The first version made each one a button calling `selectByRange`, and it
 *  was a **dead click**: an include's range falls inside the opaque block of the top-level
 *  `include` key, which `selectByRange` can by construction never match to a job. A control with no
 *  effect is either wired up or removed. */
function Body({ entry }: { entry: UnresolvedInclude }) {
  return (
    <>
      <span className="shrink-0 rounded-sm border border-border-default px-1 text-2xs tracking-label text-text-muted uppercase">
        {entry.form}
      </span>
      <span className="font-mono text-xs break-all text-text-secondary">{entry.detail}</span>
      <span className="text-2xs tracking-label text-text-muted uppercase">declared in</span>
      <span className="font-mono text-xs text-text-muted">{entry.from}</span>
    </>
  );
}
