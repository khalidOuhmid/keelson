import type { Origin, Pipeline } from "@keelson/core";
import type { Edge, Node } from "@xyflow/react";
import type { Layout } from "./layout.ts";

export const JOB_NODE_TYPE = "keelsonJob";
export const COLUMN_NODE_TYPE = "keelsonStageColumn";

export type NeedSummary = {
  job: string;
  optional: boolean;
};

export type JobNodeData = {
  id: string;
  stage: string;
  stageOrigin: Origin;
  needs: NeedSummary[];
  environment: string | null;
  extendsFrom: string[];
  selected: boolean;
  /** Le fichier où vit la définition du job, et `included` quand ce n'est pas le fichier
   *  principal. Keelson n'écrit jamais dans un fichier inclus : le nœud doit le dire avant que
   *  l'utilisateur ne clique. */
  file: string;
  included: boolean;
};

export type ColumnNodeData = {
  name: string;
  implicit: boolean;
  jobCount: number;
};

export type FlowNode =
  | (Node<JobNodeData, typeof JOB_NODE_TYPE> & { data: JobNodeData })
  | (Node<ColumnNodeData, typeof COLUMN_NODE_TYPE> & { data: ColumnNodeData });

export type EdgeData = {
  optional: boolean;
  highlighted: boolean;
};

export type FlowGraph = {
  nodes: (Node & { data: JobNodeData | ColumnNodeData })[];
  edges: Edge<EdgeData>[];
};

const COLUMN_Z = 0;
const JOB_Z = 1;

export function toFlowGraph(
  layout: Layout,
  pipeline: Pipeline,
  selectedJobId: string | null,
  headerHeight = 0,
  columnPadding = 0,
): FlowGraph {
  const positions = new Map(layout.nodes.map((node) => [node.id, node]));
  const jobs = new Map(pipeline.jobs.map((job) => [job.id, job]));

  const columnHeight = layout.height + headerHeight + columnPadding;

  const columnNodes = layout.columns.map((column) => ({
    id: `column:${column.name}`,
    type: COLUMN_NODE_TYPE,
    position: { x: column.x, y: 0 },
    data: {
      name: column.name,
      implicit: column.implicit,
      jobCount: column.jobIds.length,
    } satisfies ColumnNodeData,
    width: column.width,
    height: columnHeight,
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: COLUMN_Z,
  }));

  const jobNodes = pipeline.jobs.flatMap((job) => {
    const placed = positions.get(job.id);
    if (placed === undefined) {
      return [];
    }

    return [
      {
        id: job.id,
        type: JOB_NODE_TYPE,
        position: { x: placed.x, y: placed.y + headerHeight },
        data: {
          id: job.id,
          stage: job.stage.value,
          stageOrigin: job.stage.origin,
          needs: (job.needs?.value ?? []).map((need) => ({
            job: need.job,
            optional: need.optional,
          })),
          environment: job.environment?.value.name ?? null,
          extendsFrom: job.extends,
          selected: job.id === selectedJobId,
          file: job.file,
          included: job.file !== pipeline.main,
        } satisfies JobNodeData,
        width: placed.width,
        height: placed.height,
        zIndex: JOB_Z,
      },
    ];
  });

  const edges: Edge<EdgeData>[] = layout.edges.flatMap((edge) => {
    if (!jobs.has(edge.source) || !jobs.has(edge.target)) {
      return [];
    }

    const highlighted =
      selectedJobId !== null && (edge.source === selectedJobId || edge.target === selectedJobId);

    return [
      {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        selectable: true,
        data: { optional: edge.optional, highlighted },
        ariaLabel: edge.optional
          ? `${edge.target} optionally needs ${edge.source}`
          : `${edge.target} needs ${edge.source}`,
        style: {
          // L'arete mise en avant consomme la graisse forte et l'accent ; les autres restent en
          // retrait. Sans cela la selection n'a aucun effet visible sur le graphe, et les deux
          // tokens d'epaisseur ne sont consommes nulle part.
          stroke: highlighted ? "var(--color-accent)" : "var(--color-border-strong)",
          strokeWidth: highlighted
            ? "var(--keelson-edge-width-strong)"
            : "var(--keelson-edge-width)",
          ...(edge.optional
            ? { strokeDasharray: "var(--keelson-edge-dash) var(--keelson-edge-dash)" }
            : {}),
        },
      },
    ];
  });

  return { nodes: [...columnNodes, ...jobNodes], edges };
}
