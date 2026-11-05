import type { Toolchain } from "@keelson/core";
import type { Positions, ProposedIntegration } from "@keelson/toolchain";
import { type Edge, MarkerType, type Node } from "@xyflow/react";
import type { LayoutMetrics } from "../pipeline/layout.ts";

export const TOOLCHAIN_JOB_NODE = "toolchainJob";
export const SERVICE_NODE = "service";

export type ToolchainJobData = { id: string };

export type ServiceNodeData = {
  id: string;
  tool: string;
  environment: string | null;
  logo: string | null;
  selected: boolean;
};

export type ToolchainGraph = {
  nodes: Node<ToolchainJobData | ServiceNodeData>[];
  edges: Edge[];
};

export const jobNodeId = (job: string): string => `job:${job}`;
export const serviceNodeId = (service: string): string => `service:${service}`;

/** `tool` et `logo` viennent du catalogue : la vue passe ce qu'elle sait, le graphe reste pur. */
export type ToolLabels = ReadonlyMap<string, { name: string; logo: string | null }>;

const edgeStyle = (highlighted: boolean, dashed: boolean) => ({
  stroke: highlighted ? "var(--color-accent)" : "var(--color-border-strong)",
  strokeWidth: highlighted ? "var(--keelson-edge-width-strong)" : "var(--keelson-edge-width)",
  ...(dashed ? { strokeDasharray: "var(--keelson-edge-dash) var(--keelson-edge-dash)" } : {}),
});

/** Sans position enregistrée : jobs à gauche, services à droite. Le placement par défaut doit rester
 *  lisible, puisqu'une position n'est pas une information et n'a pas d'équivalent au clavier. */
export function toolchainGraph(
  toolchain: Toolchain,
  proposed: readonly ProposedIntegration[],
  positions: Positions,
  labels: ToolLabels,
  metrics: LayoutMetrics,
  selectedService: string | null,
): ToolchainGraph {
  const pending = proposed.flatMap((entry) =>
    entry.services.map((service) => ({ job: entry.job, service, kind: entry.kind })),
  );
  const jobs = [
    ...new Set([...toolchain.integrations, ...proposed].map((entry) => entry.job)),
  ].sort();
  const step = metrics.nodeHeight + metrics.rowGap;
  const serviceColumn = metrics.nodeWidth + metrics.columnGap * 3;
  const placed = (id: string, x: number, y: number) => positions[id] ?? { x, y };

  /** La position moyenne de ses jobs : un service suit ceux qui lui parlent, ce qui évite la plupart
   *  des croisements du placement par défaut. Un service sans lien passe à la fin. */
  const links = [...toolchain.integrations, ...pending];
  const barycentre = (service: string): number => {
    const rows = links
      .filter((entry) => entry.service === service)
      .map((entry) => jobs.indexOf(entry.job));
    return rows.length === 0 ? jobs.length : rows.reduce((sum, row) => sum + row, 0) / rows.length;
  };
  const services = toolchain.services
    .map((service) => ({ service, weight: barycentre(service.id) }))
    .sort((left, right) => left.weight - right.weight)
    .map((entry) => entry.service);
  const centred = (count: number): number =>
    ((Math.max(jobs.length, services.length) - count) * step) / 2;

  const nodes: ToolchainGraph["nodes"] = [
    ...jobs.map((job, row) => ({
      id: jobNodeId(job),
      type: TOOLCHAIN_JOB_NODE,
      position: placed(jobNodeId(job), 0, centred(jobs.length) + row * step),
      data: { id: job },
      width: metrics.nodeWidth,
      height: metrics.nodeHeight,
    })),
    ...services.map((service, row) => ({
      id: serviceNodeId(service.id),
      type: SERVICE_NODE,
      position: placed(
        serviceNodeId(service.id),
        serviceColumn,
        centred(services.length) + row * step,
      ),
      data: {
        id: service.id,
        tool: labels.get(service.tool)?.name ?? service.tool,
        environment: service.environment,
        logo: labels.get(service.tool)?.logo ?? null,
        selected: service.id === selectedService,
      },
      width: metrics.nodeWidth,
      height: metrics.nodeHeight,
    })),
  ];

  const declared = new Set(toolchain.services.map((service) => service.id));
  const edge = (
    entry: { job: string; service: string; kinds: readonly string[] },
    proposal: boolean,
  ): Edge[] => {
    if (!declared.has(entry.service)) {
      return [];
    }
    const highlighted = entry.service === selectedService;
    const words = entry.kinds.join(", ");
    const word = proposal ? `proposed ${words}` : words;
    return [
      {
        id: `${proposal ? "proposed" : "declared"}:${entry.job}:${entry.service}`,
        source: jobNodeId(entry.job),
        target: serviceNodeId(entry.service),
        label: word,
        ariaLabel: `${entry.job}, ${word}, ${entry.service}`,
        style: edgeStyle(highlighted, proposal),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: highlighted ? "var(--color-accent)" : "var(--color-border-strong)",
        },
        labelStyle: { fill: "var(--color-text-secondary)", fontSize: "var(--text-2xs)" },
        labelBgStyle: { fill: "var(--color-surface-1)" },
      },
    ];
  };

  /** Deux types sur un même lien auraient le même tracé, donc des libellés superposés. */
  const grouped = (entries: readonly { job: string; service: string; kind: string }[]) => {
    const pairs = new Map<string, { job: string; service: string; kinds: string[] }>();
    for (const { job, service, kind } of entries) {
      const key = JSON.stringify([job, service]);
      const pair = pairs.get(key) ?? { job, service, kinds: [] };
      pair.kinds.push(kind);
      pairs.set(key, pair);
    }
    return [...pairs.values()];
  };

  return {
    nodes,
    edges: [
      ...grouped(toolchain.integrations).flatMap((entry) => edge(entry, false)),
      ...grouped(pending).flatMap((entry) => edge(entry, true)),
    ],
  };
}
