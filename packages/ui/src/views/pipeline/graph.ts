import type { Origin, Pipeline } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
import type { Edge, Node } from "@xyflow/react";
import type { InheritanceEdge, Layout } from "./layout.ts";

export const JOB_NODE_TYPE = "keelsonJob";
export const COLUMN_NODE_TYPE = "keelsonStageColumn";
export const TEMPLATE_NODE_TYPE = "keelsonTemplate";
export const TEMPLATE_COLUMN_TYPE = "keelsonTemplateColumn";

export type NeedSummary = {
  job: string;
  optional: boolean;
};

export type JobNodeData = {
  id: string;
  stage: string;
  stageOrigin: Origin;
  /** GitHub: the stage is a level derived from `needs`, which the column already names. */
  derived: boolean;
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

/** `level 2` as a column or a description names it. */
export function levelName(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export type ColumnNodeData = {
  name: string;
  implicit: boolean;
  /** GitHub: a level derived from `needs`, not a stage. */
  derived: boolean;
  jobCount: number;
};

export type TemplateNodeData = {
  id: string;
  file: string;
  /** The template extends or merges another drawn template: an edge comes into it. */
  inherits: boolean;
};

export type TemplateColumnData = {
  count: number;
};

type NodeData = JobNodeData | ColumnNodeData | TemplateNodeData | TemplateColumnData;

export type FlowNode =
  | (Node<JobNodeData, typeof JOB_NODE_TYPE> & { data: JobNodeData })
  | (Node<ColumnNodeData, typeof COLUMN_NODE_TYPE> & { data: ColumnNodeData })
  | (Node<TemplateNodeData, typeof TEMPLATE_NODE_TYPE> & { data: TemplateNodeData })
  | (Node<TemplateColumnData, typeof TEMPLATE_COLUMN_TYPE> & { data: TemplateColumnData });

export type EdgeData = {
  optional: boolean;
  highlighted: boolean;
  /** On an inheritance edge only: what the value is inherited through. */
  kind?: InheritanceEdge["kind"];
};

export type FlowGraph = {
  nodes: (Node & { data: NodeData })[];
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
      derived: pipeline.provider === "github",
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
          derived: pipeline.provider === "github",
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

  const templateFiles = new Map(pipeline.templates.map((template) => [template.id, template.file]));
  const drawnTemplates = new Set(layout.templates.map((template) => template.id));
  const inheritanceDrawn = layout.inheritance.filter(
    (edge) =>
      drawnTemplates.has(edge.source) &&
      (edge.into === "job" ? jobs.has(edge.target) : drawnTemplates.has(edge.target)),
  );
  const inheriting = new Set(
    inheritanceDrawn.filter((edge) => edge.into === "template").map((edge) => edge.target),
  );
  const left = Math.min(...layout.templates.map((template) => template.x));
  const right = Math.max(...layout.templates.map((template) => template.x + template.width));
  const templateColumn =
    layout.templates.length === 0
      ? []
      : [
          {
            id: "column:templates",
            type: TEMPLATE_COLUMN_TYPE,
            position: { x: left, y: 0 },
            data: { count: layout.templates.length } satisfies TemplateColumnData,
            width: right - left,
            height: columnHeight,
            draggable: false,
            selectable: false,
            focusable: false,
            zIndex: COLUMN_Z,
          },
        ];
  const templateNodes = layout.templates.map((template) => ({
    id: `template:${template.id}`,
    type: TEMPLATE_NODE_TYPE,
    position: { x: template.x, y: template.y + headerHeight },
    data: {
      id: template.id,
      file: templateFiles.get(template.id) ?? pipeline.main,
      inherits: inheriting.has(template.id),
    } satisfies TemplateNodeData,
    width: template.width,
    height: template.height,
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: JOB_Z,
  }));

  const inheritance: Edge<EdgeData>[] = inheritanceDrawn.map((edge) => ({
    id: edge.id,
    source: `template:${edge.source}`,
    target: edge.into === "job" ? edge.target : `template:${edge.target}`,
    selectable: false,
    data: { optional: false, highlighted: false, kind: edge.kind },
    ariaLabel: `${edge.target} ${edge.kind === "merge" ? "merges" : "extends"} ${edge.source}`,
    // In the quiet border tone: an inheritance link is not a dependency. An extends is dotted; a
    // merge alternates dash and dot, and says so in words, as an optional need is only dashed.
    style: {
      stroke: "var(--color-border-default)",
      strokeWidth: "var(--keelson-edge-width)",
      strokeDasharray:
        edge.kind === "merge"
          ? "var(--keelson-edge-dash) var(--keelson-edge-dash) 0 var(--keelson-edge-dash)"
          : "0 var(--keelson-edge-dash)",
      strokeLinecap: "round",
    },
    ...(edge.kind === "merge"
      ? {
          label: "merge",
          labelStyle: { fill: "var(--color-text-muted)", fontSize: "var(--text-2xs)" },
          labelBgStyle: { fill: "var(--color-surface-0)" },
        }
      : {}),
  }));

  return {
    nodes: [...templateColumn, ...columnNodes, ...templateNodes, ...jobNodes],
    edges: [...inheritance, ...edges],
  };
}
