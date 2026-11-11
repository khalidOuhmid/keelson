import type { Pipeline } from "@keelson/core";
import { Background, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COLUMN_NODE_TYPE,
  type FlowGraph,
  JOB_NODE_TYPE,
  type LayerOverlay,
  toFlowGraph,
} from "./graph.ts";
import { JobNode } from "./JobNode.tsx";
import { type Layout, layoutPipeline } from "./layout.ts";
import { readColumnHeaderHeight, readColumnPadding, readLayoutMetrics } from "./metrics.ts";
import { StageColumnNode } from "./StageColumnNode.tsx";

const NODE_TYPES = {
  [JOB_NODE_TYPE]: JobNode,
  [COLUMN_NODE_TYPE]: StageColumnNode,
};

const EMPTY: FlowGraph = { nodes: [], edges: [] };

export type PipelineCanvasProps = {
  pipeline: Pipeline;
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
  overlay?: LayerOverlay | null;
};

/** xyflow's `fitView` only applies on mount. Opening the detail panel takes the panel's width away
 *  from the canvas without refitting it, so the right-hand columns slide under the panel and get
 *  clipped. We refit when the available width changes. */
export function RefitOnResize({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const flow = useReactFlow();
  const lastWidth = useRef<number | null>(null);

  useEffect(() => {
    const viewport = container.current;
    if (viewport === null || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || width === lastWidth.current) {
        return;
      }
      lastWidth.current = width;
      flow.fitView();
    });

    observer.observe(viewport);
    return () => observer.disconnect();
  }, [flow, container]);

  return null;
}

export function PipelineCanvas({
  pipeline,
  selectedJobId,
  onSelectJob,
  overlay = null,
}: PipelineCanvasProps) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const container = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let current = true;
    void layoutPipeline(pipeline, readLayoutMetrics()).then((result) => {
      if (current) {
        setLayout(result);
      }
    });
    return () => {
      current = false;
    };
  }, [pipeline]);

  const graph = useMemo(
    () =>
      layout === null
        ? EMPTY
        : toFlowGraph(
            layout,
            pipeline,
            selectedJobId,
            readColumnHeaderHeight(),
            readColumnPadding(),
            overlay,
          ),
    [layout, pipeline, selectedJobId, overlay],
  );

  const hasJobs = pipeline.jobs.length > 0;

  return (
    <section
      ref={container}
      aria-label="Pipeline graph"
      // Fallback focus target when the detail panel closes.
      tabIndex={-1}
      className="relative h-full w-full bg-surface-0"
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        const node = target.closest<HTMLElement>("[data-job-id]");
        onSelectJob(node?.dataset.jobId ?? null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        const target = event.target as HTMLElement;
        const node = target.closest<HTMLElement>("[data-job-id]");
        if (node?.dataset.jobId !== undefined) {
          event.preventDefault();
          onSelectJob(node.dataset.jobId);
        }
      }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesFocusable={false}
          edgesFocusable={false}
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

      {layout !== null && !hasJobs ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-text-muted">
          No jobs in this pipeline yet.
        </p>
      ) : null}
    </section>
  );
}
