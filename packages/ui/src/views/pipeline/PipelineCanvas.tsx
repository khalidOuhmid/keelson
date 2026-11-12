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
import { KEYBOARD_HINT, KEYBOARD_HINT_ID, move, moveForKey, tabStop } from "./navigation.ts";
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

/** Keyboard focus can land on a node the viewport does not show: the graph pans to it, at the
 *  current zoom. */
export function RevealFocused({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const flow = useReactFlow();

  useEffect(() => {
    const viewport = container.current;
    if (viewport === null) {
      return;
    }
    const reveal = (event: FocusEvent): void => {
      const id = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-job-id]")
        ?.dataset.jobId;
      const node = id === undefined ? undefined : flow.getNode(id);
      if (node === undefined) {
        return;
      }
      // Measured in flow coordinates: the browser's own focus scrolling moves the DOM box without
      // moving the viewport, so a DOM rectangle read here would lie.
      const { x, y, zoom } = flow.getViewport();
      const width = node.width ?? 0;
      const height = node.height ?? 0;
      const left = node.position.x * zoom + x;
      const top = node.position.y * zoom + y;
      const inside =
        left >= 0 &&
        top >= 0 &&
        left + width * zoom <= viewport.clientWidth &&
        top + height * zoom <= viewport.clientHeight;
      if (!inside) {
        void flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom });
      }
    };
    viewport.addEventListener("focusin", reveal);
    return () => viewport.removeEventListener("focusin", reveal);
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
  const [active, setActive] = useState<string | null>(null);

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

  const stop = layout === null ? null : tabStop(layout, [active, selectedJobId]);

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
            stop,
          ),
    [layout, pipeline, selectedJobId, overlay, stop],
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
      onFocus={(event) => {
        const id = (event.target as HTMLElement).closest<HTMLElement>("[data-job-id]")?.dataset
          .jobId;
        if (id !== undefined) {
          setActive(id);
        }
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const id = target.closest<HTMLElement>("[data-job-id]")?.dataset.jobId;
        if (id === undefined) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectJob(id);
          return;
        }
        const direction = moveForKey(event.key, event.shiftKey);
        if (direction === null || layout === null || event.altKey || event.metaKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const next = move(layout, pipeline, id, direction);
        if (next !== null) {
          container.current
            ?.querySelector<HTMLElement>(`[data-job-id="${CSS.escape(next)}"]`)
            ?.focus({ preventScroll: true });
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
          <RevealFocused container={container} />
        </ReactFlow>
      </ReactFlowProvider>

      <p id={KEYBOARD_HINT_ID} className="sr-only">
        {KEYBOARD_HINT}
      </p>

      {layout !== null && !hasJobs ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-text-muted">
          No jobs in this pipeline yet.
        </p>
      ) : null}
    </section>
  );
}
