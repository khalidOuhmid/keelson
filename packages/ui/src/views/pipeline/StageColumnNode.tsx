import type { NodeProps } from "@xyflow/react";
import type { ColumnNodeData } from "./graph.ts";

export type StageColumnNodeProps = NodeProps & {
  data: ColumnNodeData;
};

export function StageColumnNode({ data }: StageColumnNodeProps) {
  const jobs = `${data.jobCount} ${data.jobCount === 1 ? "job" : "jobs"}`;

  return (
    <section
      aria-label={`Stage ${data.name}`}
      className="h-full w-full rounded-lg border border-border-subtle bg-surface-1"
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-border-subtle px-2.5 py-1.5">
        <span className="flex items-baseline gap-1.5 overflow-hidden">
          <span
            data-testid="stage-column-name"
            className="truncate font-mono text-sm font-semibold text-text-primary"
          >
            {data.name}
          </span>
          {data.implicit ? (
            <span
              title="This stage is not declared in the file; GitLab implies it."
              className="rounded-sm border border-border-default px-1 text-2xs tracking-label text-text-muted uppercase"
            >
              implicit
            </span>
          ) : null}
        </span>
        <span className="shrink-0 font-mono text-2xs text-text-muted tabular-nums">{jobs}</span>
      </header>
    </section>
  );
}
