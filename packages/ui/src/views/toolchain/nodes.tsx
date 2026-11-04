import { Handle, type NodeProps, Position } from "@xyflow/react";
import { LAYER_GENERIC_GLYPH, LogoGlyph } from "../../icons.tsx";
import type { ServiceNodeData, ToolchainJobData } from "./graph.ts";

export function ToolchainJobNode({ data }: NodeProps & { data: ToolchainJobData }) {
  return (
    <>
      <div
        data-toolchain-job={data.id}
        className="flex h-full w-full items-center rounded-md border border-border-default bg-surface-1 px-2.5 py-2"
      >
        <span className="truncate text-base font-semibold text-text-primary">{data.id}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

export function ServiceNode({ data }: NodeProps & { data: ServiceNodeData }) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border-strong" />
      <button
        type="button"
        aria-pressed={data.selected}
        data-service-id={data.id}
        className="flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md border border-border-default bg-surface-2 px-2.5 py-2 text-left transition-colors duration-fast ease-out hover:bg-surface-3 aria-pressed:border-accent aria-pressed:bg-surface-3"
      >
        <span className="flex items-center gap-1.5 overflow-hidden text-base font-semibold text-text-primary">
          {data.logo === null ? LAYER_GENERIC_GLYPH : <LogoGlyph path={data.logo} />}
          <span className="truncate">{data.id}</span>
        </span>
        <span className="truncate text-xs text-text-muted">
          {data.tool}
          {data.environment === null ? "" : ` · ${data.environment}`}
        </span>
      </button>
    </>
  );
}
