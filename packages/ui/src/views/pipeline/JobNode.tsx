import { findLayer } from "@keelson/taxonomy";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { LayerTags } from "../coverage/LayerTag.tsx";
import type { JobNodeData, NeedSummary } from "./graph.ts";
import { OriginBadge } from "./OriginBadge.tsx";

export const READ_ONLY_TAG = "read-only";

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
  const descriptionId = `job-${data.id}-description`;
  const description = [
    data.included ? `From included file ${data.file}. Read-only.` : "",
    data.layers === null || data.layers.length === 0
      ? ""
      : `Layers: ${data.layers.map((id) => findLayer(id).name).join(", ")}.`,
    `Stage ${data.stage}.`,
    describeNeeds(data.needs),
    data.environment === null ? "" : `Environment ${data.environment}.`,
    data.extendsFrom.length === 0 ? "" : `Extends ${data.extendsFrom.join(", ")}.`,
  ]
    .filter((part) => part !== "")
    .join(" ");

  /** An included node drops one elevation level and loses its hover reaction: an object Keelson
   *  will never write must not look interactive. The mark does not rely on this tone — the word
   *  `read-only` is there, and the description read by a screen reader says it too.
   *
   *  The **border** stays `border-default`. The first version lowered it to `border-subtle`, which
   *  `DESIGN.md` explicitly forbids for a component boundary: measured at 1.26:1 against the
   *  column, it read not as "not editable" but as "not an object", and the job lost its status as
   *  a thing on the audit screenshot. Legibility of the object is not what a non-editable job
   *  gives up. */
  const surface = data.included
    ? "bg-surface-1 data-[selected=false]:border-border-default"
    : "bg-surface-2 hover:bg-surface-3 data-[selected=false]:border-border-default";

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border-strong" />
      <button
        type="button"
        aria-pressed={data.selected}
        aria-describedby={descriptionId}
        data-job-id={data.id}
        data-selected={data.selected}
        data-included={data.included}
        data-emphasised={data.emphasised}
        className={`group flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-fast ease-out data-[emphasised=true]:outline-2 data-[emphasised=true]:outline-accent data-[selected=true]:border-accent data-[selected=true]:bg-surface-3 ${surface}`}
      >
        <span className="flex items-center gap-1.5 overflow-hidden">
          <span className="truncate text-base font-semibold text-text-primary">{data.id}</span>
          {data.included ? <ReadOnlyTag /> : null}
        </span>
        {/* On the overlay, the stage repeats the column: it gives up its place to the tags. */}
        <span className="flex items-center gap-1 overflow-hidden">
          {data.layers !== null ? (
            <LayerTags layers={data.layers} limit={2} />
          ) : (
            <>
              <span className="truncate font-mono text-xs text-text-muted">{data.stage}</span>
              {data.included ? null : <OriginBadge origin={data.stageOrigin} />}
            </>
          )}
        </span>
      </button>
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

export function ReadOnlyTag() {
  return (
    <span className="shrink-0 rounded-sm border border-border-default px-1 text-2xs font-normal tracking-label text-text-muted uppercase">
      {READ_ONLY_TAG}
    </span>
  );
}
