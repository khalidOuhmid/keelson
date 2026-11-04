import {
  applyNodeChanges,
  Background,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { ToolchainPayload } from "../../api/client.ts";
import { readLayoutMetrics } from "../pipeline/metrics.ts";
import { SERVICE_NODE, TOOLCHAIN_JOB_NODE, type ToolLabels, toolchainGraph } from "./graph.ts";
import { ServiceNode, ToolchainJobNode } from "./nodes.tsx";

const NODE_TYPES = {
  [TOOLCHAIN_JOB_NODE]: ToolchainJobNode,
  [SERVICE_NODE]: ServiceNode,
};

export type ToolchainCanvasProps = {
  payload: ToolchainPayload;
  labels: ToolLabels;
  selectedService: string | null;
  onSelectService: (id: string | null) => void;
  onMove: (node: string, position: { x: number; y: number }) => void;
};

export function ToolchainCanvas({
  payload,
  labels,
  selectedService,
  onSelectService,
  onMove,
}: ToolchainCanvasProps) {
  const graph = useMemo(
    () =>
      toolchainGraph(
        payload.toolchain,
        payload.proposed,
        payload.positions,
        labels,
        readLayoutMetrics(),
        selectedService,
      ),
    [payload, labels, selectedService],
  );

  const [nodes, setNodes] = useState<Node[]>(graph.nodes);
  useEffect(() => setNodes(graph.nodes), [graph]);

  return (
    <section
      aria-label="Toolchain graph"
      tabIndex={-1}
      className="relative h-full w-full bg-surface-0"
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        const node = target.closest<HTMLElement>("[data-service-id]");
        onSelectService(node?.dataset.serviceId ?? null);
      }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={(changes: NodeChange[]) =>
            setNodes((current) => applyNodeChanges(changes, current))
          }
          onNodeDragStop={(_event, node) => onMove(node.id, node.position)}
          nodesDraggable
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          fitView
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>

      {graph.nodes.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-text-muted">
          No services declared yet.
        </p>
      ) : null}
    </section>
  );
}
