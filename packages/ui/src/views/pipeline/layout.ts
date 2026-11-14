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

/** A link a value is inherited along: `extends`, or a merge key (`<<: *anchor`) on a template's
 *  map. `into` says whether the target is a job or another template. */
export type InheritanceEdge = {
  id: string;
  source: string;
  target: string;
  kind: "extends" | "merge";
  into: "job" | "template";
};

export type Layout = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  columns: LayoutColumn[];
  /** The hidden jobs values are inherited from, in columns upstream of the stages: they are not
   *  jobs, so no stage column holds them. A template inheriting from another is drawn one column
   *  downstream of its parent. */
  templates: LayoutNode[];
  /** One per `extends` entry or merged template that names a drawn template. */
  inheritance: InheritanceEdge[];
  height: number;
};

type Inheriting = { id: string; extends: readonly string[]; merges?: readonly string[] };

function parentsOf(entry: Inheriting, drawn: ReadonlySet<string>): string[] {
  return [...new Set([...entry.extends, ...(entry.merges ?? [])])].filter(
    (parent) => parent !== entry.id && drawn.has(parent),
  );
}

/** A cycle is cut where it is met: its templates share the depth of the first one reached. */
function depths(pipeline: Pipeline, drawn: ReadonlySet<string>): Map<string, number> {
  const byId = new Map(pipeline.templates.map((template) => [template.id, template]));
  const found = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = found.get(id);
    if (known !== undefined) {
      return known;
    }
    const template = byId.get(id);
    if (template === undefined || visiting.has(id)) {
      return -1;
    }
    visiting.add(id);
    const depth = Math.max(-1, ...parentsOf(template, drawn).map(depthOf)) + 1;
    visiting.delete(id);
    found.set(id, depth);
    return depth;
  };
  for (const template of pipeline.templates) {
    depthOf(template.id);
  }
  return found;
}

function inheritanceEdges(
  entry: Inheriting,
  into: InheritanceEdge["into"],
  drawn: ReadonlySet<string>,
): InheritanceEdge[] {
  const named = (parents: readonly string[]) =>
    [...new Set(parents)].filter((parent) => parent !== entry.id && drawn.has(parent));
  return [
    ...named(entry.extends).map((parent) => ({
      id: `${parent}=>${entry.id}`,
      source: parent,
      target: entry.id,
      kind: "extends" as const,
      into,
    })),
    ...named(entry.merges ?? []).map((parent) => ({
      id: `${parent}<<${entry.id}`,
      source: parent,
      target: entry.id,
      kind: "merge" as const,
      into,
    })),
  ];
}

function placeTemplates(
  pipeline: Pipeline,
  metrics: LayoutMetrics,
): Pick<Layout, "templates" | "inheritance"> {
  const drawn = new Set(pipeline.templates.map((template) => template.id));
  const depth = depths(pipeline, drawn);
  const levels = Math.max(0, ...depth.values()) + 1;
  const step = metrics.nodeWidth + metrics.columnGap;
  const rows = new Map<number, number>();
  const templates = pipeline.templates.map((template) => {
    const level = depth.get(template.id) ?? 0;
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    return {
      id: template.id,
      x: -(levels - level) * step,
      y: row * (metrics.nodeHeight + metrics.rowGap),
      width: metrics.nodeWidth,
      height: metrics.nodeHeight,
    };
  });
  const inheritance = [
    ...pipeline.templates.flatMap((template) => inheritanceEdges(template, "template", drawn)),
    ...pipeline.jobs.flatMap((job) => inheritanceEdges(job, "job", drawn)),
  ].sort((left, right) => left.id.localeCompare(right.id));
  return { templates, inheritance };
}

function tallest(nodes: readonly LayoutNode[]): number {
  return nodes.reduce((height, node) => Math.max(height, node.y + node.height), 0);
}

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

  const inherited = placeTemplates(pipeline, metrics);

  if (pipeline.jobs.length === 0) {
    return {
      nodes: [],
      edges: [],
      columns: columns.map((column, index) => ({
        ...column,
        x: index * (metrics.nodeWidth + metrics.columnGap),
        width: metrics.nodeWidth,
      })),
      ...inherited,
      height: tallest(inherited.templates),
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

  const laidColumns: LayoutColumn[] = columns.map((column, index) => ({
    ...column,
    x: index * (metrics.nodeWidth + metrics.columnGap),
    width: metrics.nodeWidth,
  }));

  const placed = new Map<string, LayoutNode>(
    (laid.children ?? []).map((child) => [
      child.id,
      {
        id: child.id,
        x: laidColumns[columnOf.get(child.id) ?? 0]?.x ?? 0,
        y: child.y ?? 0,
        width: metrics.nodeWidth,
        height: child.height ?? metrics.nodeHeight,
      },
    ]),
  );

  // elkjs now decides only the vertical order: forcing x onto the partition can bring two nodes it
  // had put in separate layers back into the same column, hence at the same y. We offset them.
  for (const column of laidColumns) {
    const members = column.jobIds
      .map((id) => placed.get(id))
      .filter((node): node is LayoutNode => node !== undefined)
      .sort((left, right) =>
        left.y !== right.y ? left.y - right.y : left.id.localeCompare(right.id),
      );

    let floor = Number.NEGATIVE_INFINITY;
    for (const node of members) {
      node.y = Math.max(node.y, floor);
      floor = node.y + node.height + metrics.rowGap;
    }
  }

  const nodes: LayoutNode[] = [...placed.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  return {
    nodes,
    edges: [...edges].sort((left, right) => left.id.localeCompare(right.id)),
    columns: laidColumns,
    ...inherited,
    height: Math.max(tallest(nodes), tallest(inherited.templates)),
  };
}
