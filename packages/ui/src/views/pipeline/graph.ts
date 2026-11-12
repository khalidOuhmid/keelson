import type { Origin, Pipeline } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
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
  /** The file where the job's definition lives, and `included` when it is not the main file.
   *  Keelson never writes to an included file: the node must say so before the user clicks. */
  file: string;
  included: boolean;
  /** On the overlay only: `null` outside the Coverage view. */
  layers: readonly LayerId[] | null;
  /** The job carries the layer chosen in the panel. */
  emphasised: boolean;
  /** The graph's one tab stop (roving tabindex): every other job is reached with the arrows. */
  tabStop?: boolean;
};

export type LayerOverlay = {
  jobs: ReadonlyMap<string, readonly LayerId[]>;
  selected: LayerId | null;
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
  overlay: LayerOverlay | null = null,
  tabStop: string | null = null,
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
          // The chosen layer goes first: otherwise it can stay hidden behind "+2".
          layers:
            overlay === null
              ? null
              : [...(overlay.jobs.get(job.id) ?? [])].sort(
                  (left, right) =>
                    Number(right === overlay.selected) - Number(left === overlay.selected),
                ),
          emphasised:
            overlay?.selected != null &&
            (overlay.jobs.get(job.id) ?? []).includes(overlay.selected),
          tabStop: job.id === tabStop,
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
          // The highlighted edge uses the strong weight and the accent; the others stay in the
          // background. Without this the selection has no visible effect on the graph, and the two
          // width tokens are consumed nowhere.
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
