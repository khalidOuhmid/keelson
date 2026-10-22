import type { Pipeline } from "@keelson/core";
import { Background, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { COLUMN_NODE_TYPE, type FlowGraph, JOB_NODE_TYPE, toFlowGraph } from "./graph.ts";
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
};

/** `fitView` de xyflow ne s'applique qu'au montage. Ouvrir le panneau de détail retire au canevas
 *  la largeur du panneau sans le recadrer, donc les colonnes de droite passent sous le panneau et sont
 *  tronquées. On réajuste quand la largeur disponible change. */
function RefitOnResize() {
  const flow = useReactFlow();
  const lastWidth = useRef<number | null>(null);

  useEffect(() => {
    const viewport = document.querySelector(".react-flow");
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
  }, [flow]);

  return null;
}

export function PipelineCanvas({ pipeline, selectedJobId, onSelectJob }: PipelineCanvasProps) {
  const [layout, setLayout] = useState<Layout | null>(null);

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
          ),
    [layout, pipeline, selectedJobId],
  );

  const hasJobs = pipeline.jobs.length > 0;

  return (
    <section
      aria-label="Pipeline graph"
      // Cible de repli du focus quand le panneau de detail se ferme.
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
          <RefitOnResize />
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
