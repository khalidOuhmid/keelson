import {
  applyNodeChanges,
  Background,
  Controls,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolchainPayload } from "../../api/client.ts";
import { BUTTON, DANGER_BUTTON, GROUP } from "../../editing/controls.ts";
import { trapTab } from "../../focus.ts";
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
  onResetLayout: () => void;
  invalid: boolean;
};

function ResetLayout({ onReset }: { onReset: () => void }) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) {
      confirm.current?.focus();
    }
  }, [asking]);
  const cancel = (): void => {
    setAsking(false);
    trigger.current?.focus();
  };

  return (
    <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1.5">
      <button
        ref={trigger}
        type="button"
        className={`${BUTTON} bg-surface-2`}
        aria-expanded={asking}
        onClick={() => setAsking(true)}
      >
        Reset layout
      </button>
      {asking ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Reset layout"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              cancel();
              return;
            }
            trapTab(event.currentTarget, event);
          }}
          className={`${GROUP} max-w-64 rounded-md border border-border-default bg-surface-2 p-2.5`}
        >
          <p className="text-xs text-text-secondary">
            Put every node back in its default place? The saved positions are removed from
            layout.json.
          </p>
          <div className="flex gap-1.5">
            <button
              ref={confirm}
              type="button"
              className={DANGER_BUTTON}
              onClick={() => {
                setAsking(false);
                onReset();
              }}
            >
              Reset positions
            </button>
            <button type="button" className={BUTTON} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ToolchainCanvas({
  payload,
  labels,
  selectedService,
  onSelectService,
  onMove,
  onResetLayout,
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
          colorMode="dark"
          fitView
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background />
          <Controls showInteractive={false} position="bottom-right" />
          <RefitOnResize container={container} keepMovedView />
        </ReactFlow>
      </ReactFlowProvider>

      {!invalid && Object.keys(payload.positions).length > 0 ? (
        <ResetLayout onReset={onResetLayout} />
      ) : null}

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
