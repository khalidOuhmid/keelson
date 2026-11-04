import { Handle, type NodeProps, Position } from "@xyflow/react";
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
    `Stage ${data.stage}.`,
    describeNeeds(data.needs),
    data.environment === null ? "" : `Environment ${data.environment}.`,
    data.extendsFrom.length === 0 ? "" : `Extends ${data.extendsFrom.join(", ")}.`,
  ]
    .filter((part) => part !== "")
    .join(" ");

  /** Un nœud inclus descend d'un plan et perd sa réaction au survol : un objet que Keelson
   *  n'écrira jamais n'a pas le droit d'avoir l'air réactif. La marque ne repose pas sur ce ton —
   *  le mot `read-only` est là, et la description lue par un lecteur d'écran le dit aussi.
   *
   *  La **bordure** reste `border-default`. La première version la descendait à `border-subtle`,
   *  ce que `DESIGN.md` interdit nommément pour une limite de composant : mesurée à 1,26:1 contre
   *  la colonne, elle ne se lisait pas « non éditable » mais « pas un objet », et le job perdait
   *  son statut de chose sur la capture d'audit. La lisibilité de l'objet n'est pas ce qu'on
   *  retire à un job non éditable. */
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
        className={`group flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-fast ease-out data-[selected=true]:border-accent data-[selected=true]:bg-surface-3 ${surface}`}
      >
        <span className="flex items-center gap-1.5 overflow-hidden">
          <span className="truncate text-base font-semibold text-text-primary">{data.id}</span>
          {data.included ? <ReadOnlyTag /> : null}
        </span>
        <span className="flex items-center gap-1 overflow-hidden">
          <span className="truncate font-mono text-xs text-text-muted">{data.stage}</span>
          {/* Pas de badge d'origine sur un nœud inclus : mesuré, il occupait 178 px d'une ligne de
              205 et réduisait le stage à 23 px tronqués, en coupant 55 % du chemin qu'il était
              censé porter. Le tag `read-only` dit déjà le fait, et le panneau le détaille. */}
          {data.included ? null : <OriginBadge origin={data.stageOrigin} />}
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
