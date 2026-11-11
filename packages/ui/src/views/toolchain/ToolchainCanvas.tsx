import {
  applyNodeChanges,
  Background,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolchainPayload } from "../../api/client.ts";
import { readLayoutMetrics } from "../pipeline/metrics.ts";
import { RefitOnResize } from "../pipeline/PipelineCanvas.tsx";
import { SERVICE_NODE, TOOLCHAIN_JOB_NODE, type ToolLabels, toolchainGraph } from "./graph.ts";
import { ServiceNode, ToolchainJobNode } from "./nodes.tsx";

/** Below this zoom, names drop under 11 px: better a graph to pan around than an unreadable one. */
const FIT_MIN_ZOOM = 0.6;

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
  invalid: boolean;
};

export function ToolchainCanvas({
  payload,
  labels,
  selectedService,
  onSelectService,
  onMove,
  invalid,
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

  const container = useRef<HTMLElement>(null);
  const [nodes, setNodes] = useState<Node[]>(graph.nodes);
  useEffect(() => setNodes(graph.nodes), [graph]);

  return (
    <section
      ref={container}
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
          nodesDraggable={!invalid}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          disableKeyboardA11y
          fitViewOptions={{ minZoom: FIT_MIN_ZOOM }}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          fitView
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background />
          <RefitOnResize container={container} />
        </ReactFlow>
      </ReactFlowProvider>

      {graph.nodes.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-text-muted">
          {invalid
            ? "toolchain.yaml can't be read. Editing is off; see Diagnostics."
            : "No services declared yet. Add one from the panel."}
        </p>
      ) : null}
    </section>
  );
}
