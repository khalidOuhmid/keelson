import type { Pipeline } from "@keelson/core";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

export type LayoutMetrics = {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
};

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  optional: boolean;
};

export type LayoutColumn = {
  name: string;
  implicit: boolean;
  jobIds: string[];
  x: number;
  width: number;
};

export type Layout = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  columns: LayoutColumn[];
  width: number;
  height: number;
};

type Partitioned = {
  name: string;
  implicit: boolean;
  jobIds: string[];
};

function partitions(pipeline: Pipeline): Partitioned[] {
  const columns: Partitioned[] = pipeline.stages.map((stage) => ({
    name: stage.name,
    implicit: stage.implicit,
    jobIds: [],
  }));
  const byName = new Map(columns.map((column, index) => [column.name, index]));

  for (const job of pipeline.jobs) {
    const index = byName.get(job.stage.value);
    if (index !== undefined) {
      columns[index]?.jobIds.push(job.id);
      continue;
    }
    const extra = columns.find((column) => column.name === job.stage.value);
    if (extra === undefined) {
      columns.push({ name: job.stage.value, implicit: false, jobIds: [job.id] });
      byName.set(job.stage.value, columns.length - 1);
    } else {
      extra.jobIds.push(job.id);
    }
  }

  return columns;
}

export async function layoutPipeline(pipeline: Pipeline, metrics: LayoutMetrics): Promise<Layout> {
  const columns = partitions(pipeline);
  const known = new Set(pipeline.jobs.map((job) => job.id));
  const columnOf = new Map<string, number>();
  for (const [index, column] of columns.entries()) {
    for (const id of column.jobIds) {
      columnOf.set(id, index);
    }
  }

  const edges: LayoutEdge[] = [];
  for (const job of pipeline.jobs) {
    for (const need of job.needs?.value ?? []) {
      if (!known.has(need.job)) {
        continue;
      }
      edges.push({
        id: `${need.job}->${job.id}`,
        source: need.job,
        target: job.id,
        optional: need.optional,
      });
    }
  }

  if (pipeline.jobs.length === 0) {
    return {
      nodes: [],
      edges: [],
      columns: columns.map((column, index) => ({
        ...column,
        x: index * (metrics.nodeWidth + metrics.columnGap),
        width: metrics.nodeWidth,
      })),
      width: columns.length * (metrics.nodeWidth + metrics.columnGap),
      height: 0,
    };
  }

  const ordered = [...pipeline.jobs].sort((left, right) => {
    const byColumn = (columnOf.get(left.id) ?? 0) - (columnOf.get(right.id) ?? 0);
    return byColumn !== 0 ? byColumn : left.id.localeCompare(right.id);
  });

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.partitioning.activate": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(metrics.columnGap),
      "elk.spacing.nodeNode": String(metrics.rowGap),
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.layered.nodePlacement.strategy": "SIMPLE",
    },
    children: ordered.map((job) => ({
      id: job.id,
      width: metrics.nodeWidth,
      height: metrics.nodeHeight,
      layoutOptions: {
        "elk.partitioning.partition": String(columnOf.get(job.id) ?? columns.length),
      },
    })),
    edges: [...edges]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };

  const laid = await new ELK().layout(graph);

  const nodes: LayoutNode[] = (laid.children ?? [])
    .map((child) => ({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? metrics.nodeWidth,
      height: child.height ?? metrics.nodeHeight,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return {
    nodes,
    edges: [...edges].sort((left, right) => left.id.localeCompare(right.id)),
    columns: columns.map((column, index) => {
      const first = column.jobIds
        .map((id) => nodeById.get(id)?.x)
        .find((value): value is number => value !== undefined);
      return {
        ...column,
        x: first ?? index * (metrics.nodeWidth + metrics.columnGap),
        width: metrics.nodeWidth,
      };
    }),
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}
