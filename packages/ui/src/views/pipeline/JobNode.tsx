import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { JobNodeData, NeedSummary } from "./graph.ts";
import { OriginBadge } from "./OriginBadge.tsx";

function describeNeeds(needs: readonly NeedSummary[]): string {
  if (needs.length === 0) {
    return "No dependencies.";
  }
  const listed = needs
    .map((need) => (need.optional ? `${need.job} (optional)` : need.job))
    .join(", ");
  return `Needs ${listed}.`;
}

export type JobNodeProps = NodeProps & {
  data: JobNodeData;
};

export function JobNode({ data }: JobNodeProps) {
  const description = [
    `Stage ${data.stage}.`,
    describeNeeds(data.needs),
    data.environment === null ? "" : `Environment ${data.environment}.`,
    data.extendsFrom.length === 0 ? "" : `Extends ${data.extendsFrom.join(", ")}.`,
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border-strong" />
      <button
        type="button"
        aria-pressed={data.selected}
        aria-description={description}
        data-job-id={data.id}
        data-selected={data.selected}
        className="group flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md border bg-surface-2 px-2.5 py-2 text-left transition-colors duration-fast ease-out hover:bg-surface-3 data-[selected=false]:border-border-default data-[selected=true]:border-accent data-[selected=true]:bg-surface-3"
      >
        <span className="truncate text-base font-semibold text-text-primary">{data.id}</span>
        <span className="flex items-center gap-1 overflow-hidden">
          <span className="truncate font-mono text-xs text-text-muted">{data.stage}</span>
          <OriginBadge origin={data.stageOrigin} />
        </span>
      </button>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}
