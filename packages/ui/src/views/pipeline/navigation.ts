import type { Pipeline } from "@keelson/core";
import type { Layout } from "./layout.ts";

export type Move = "up" | "down" | "left" | "right" | "first" | "last" | "need" | "dependent";

export const KEYBOARD_HINT_ID = "pipeline-graph-keys";

export const KEYBOARD_HINT =
  "Arrow keys move between jobs: up and down within a stage, left and right across stages. Shift with Left or Right follows a dependency to a job it needs or a job that needs it. Home and End reach the first and last job. Enter opens a job.";

/** Non-empty columns in stage order, each listed top to bottom as drawn. */
function grid(layout: Layout): { id: string; y: number }[][] {
  const placed = new Map(layout.nodes.map((node) => [node.id, node.y]));
  return layout.columns
    .map((column) =>
      column.jobIds
        .flatMap((id) => {
          const y = placed.get(id);
          return y === undefined ? [] : [{ id, y }];
        })
        .sort((left, right) => left.y - right.y),
    )
    .filter((column) => column.length > 0);
}

/** The graph's single tab stop: the first candidate still drawn, else the first job. */
export function tabStop(layout: Layout, candidates: readonly (string | null)[]): string | null {
  const columns = grid(layout);
  const drawn = new Set(columns.flat().map((cell) => cell.id));
  const chosen = candidates.find((id): id is string => id !== null && drawn.has(id));
  return chosen ?? columns[0]?.[0]?.id ?? null;
}

export function move(layout: Layout, pipeline: Pipeline, from: string, to: Move): string | null {
  const columns = grid(layout);
  const column = columns.findIndex((cells) => cells.some((cell) => cell.id === from));
  const cells = columns[column];
  if (cells === undefined) {
    return null;
  }
  const row = cells.findIndex((cell) => cell.id === from);
  const y = cells[row]?.y ?? 0;
  const drawn = new Set(columns.flat().map((cell) => cell.id));

  switch (to) {
    case "up":
      return cells[Math.max(0, row - 1)]?.id ?? null;
    case "down":
      return cells[Math.min(cells.length - 1, row + 1)]?.id ?? null;
    case "left":
    case "right": {
      const next = columns[column + (to === "left" ? -1 : 1)];
      if (next === undefined) {
        return from;
      }
      return (
        [...next].sort((left, right) => Math.abs(left.y - y) - Math.abs(right.y - y))[0]?.id ?? from
      );
    }
    case "first":
      return columns[0]?.[0]?.id ?? null;
    case "last": {
      const end = columns[columns.length - 1];
      return end?.[end.length - 1]?.id ?? null;
    }
    case "need": {
      const job = pipeline.jobs.find((candidate) => candidate.id === from);
      const target = (job?.needs?.value ?? []).find((need) => drawn.has(need.job));
      return target?.job ?? from;
    }
    case "dependent": {
      const dependent = columns
        .flat()
        .find((cell) =>
          pipeline.jobs
            .find((candidate) => candidate.id === cell.id)
            ?.needs?.value.some((need) => need.job === from),
        );
      return dependent?.id ?? from;
    }
  }
}

export function moveForKey(key: string, shift: boolean): Move | null {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return shift ? "need" : "left";
    case "ArrowRight":
      return shift ? "dependent" : "right";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}
