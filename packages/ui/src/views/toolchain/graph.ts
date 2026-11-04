import type { Toolchain } from "@keelson/core";
import type { Positions, ProposedIntegration } from "@keelson/toolchain";
import type { Edge, Node } from "@xyflow/react";
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
    ...new Set([...toolchain.integrations, ...pending].map((entry) => entry.job)),
  ].sort();
  const step = metrics.nodeHeight + metrics.rowGap;
  const serviceColumn = metrics.nodeWidth + metrics.columnGap * 3;
  const placed = (id: string, x: number, y: number) => positions[id] ?? { x, y };

  const nodes: ToolchainGraph["nodes"] = [
    ...jobs.map((job, row) => ({
      id: jobNodeId(job),
      type: TOOLCHAIN_JOB_NODE,
      position: placed(jobNodeId(job), 0, row * step),
      data: { id: job },
      width: metrics.nodeWidth,
      height: metrics.nodeHeight,
    })),
    ...toolchain.services.map((service, row) => ({
      id: serviceNodeId(service.id),
      type: SERVICE_NODE,
      position: placed(serviceNodeId(service.id), serviceColumn, row * step),
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
    entry: { job: string; service: string; kind: string },
    proposal: boolean,
  ): Edge[] => {
    if (!declared.has(entry.service)) {
      return [];
    }
    const highlighted = entry.service === selectedService;
    const word = proposal ? `proposed ${entry.kind}` : entry.kind;
    return [
      {
        id: `${proposal ? "proposed" : "declared"}:${entry.job}:${entry.service}:${entry.kind}`,
        source: jobNodeId(entry.job),
        target: serviceNodeId(entry.service),
        label: word,
        ariaLabel: `${entry.job}, ${word}, ${entry.service}`,
        style: edgeStyle(highlighted, proposal),
        labelStyle: { fill: "var(--color-text-secondary)" },
        labelBgStyle: { fill: "var(--color-surface-1)" },
      },
    ];
  };

  return {
    nodes,
    edges: [
      ...toolchain.integrations.flatMap((entry) => edge(entry, false)),
      ...pending.flatMap((entry) => edge(entry, true)),
    ],
  };
}
