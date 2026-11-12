import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { TemplateColumnData, TemplateNodeData } from "./graph.ts";

export type TemplateNodeProps = NodeProps & { data: TemplateNodeData };

/** A hidden job: values come from it, nothing runs it. Dashed and unfilled, so it never reads as a
 *  job, and not a button: there is nothing to select or edit on it. */
export function TemplateNode({ data }: TemplateNodeProps) {
  return (
    <>
      {data.inherits ? (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="!bg-border-strong"
        />
      ) : null}
      <div
        data-template-id={data.id}
        className="flex h-full w-full flex-col justify-center gap-0.5 rounded-md border border-dashed border-border-strong bg-surface-0 px-2.5 py-2"
      >
        <span className="truncate font-mono text-sm text-text-secondary">{data.id}</span>
        <span className="text-2xs font-semibold tracking-label text-text-muted uppercase">
          template
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!bg-border-strong"
      />
    </>
  );
}

export type TemplateColumnNodeProps = NodeProps & { data: TemplateColumnData };

export function TemplateColumnNode({ data }: TemplateColumnNodeProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: like a stage column, a group and not a landmark
    <div
      role="group"
      aria-label="Templates"
      className="h-full w-full rounded-lg border border-dashed border-border-subtle"
    >
      <header className="flex h-[var(--keelson-column-header-height)] items-center justify-between gap-2 border-b border-dashed border-border-subtle px-2.5">
        <span className="truncate text-2xs font-semibold tracking-label text-text-muted uppercase">
          Templates
        </span>
        <span className="shrink-0 font-mono text-2xs text-text-muted tabular-nums">
          {data.count} {data.count === 1 ? "template" : "templates"}
        </span>
      </header>
    </div>
  );
}
