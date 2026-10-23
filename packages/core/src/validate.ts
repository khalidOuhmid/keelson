import type { Diagnostic } from "./diagnostics.ts";
import { NEED_LATER_STAGE, NEEDS_CYCLE, UNKNOWN_NEED, UNKNOWN_STAGE } from "./diagnostics.ts";
import type { Job, Pipeline } from "./ir.ts";

type Graph = ReadonlyMap<string, readonly string[]>;

function required<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`key missing from internal table: ${String(key)}`);
  }
  return value;
}

function buildGraph(jobs: readonly Job[], known: ReadonlySet<string>): Graph {
  const graph = new Map<string, readonly string[]>();
  for (const job of jobs) {
    const targets = (job.needs?.value ?? [])
      .map((need) => need.job)
      .filter((target) => known.has(target));
    graph.set(job.id, targets);
  }
  return graph;
}

function stronglyConnected(ids: readonly string[], graph: Graph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const open = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
  };

  for (const root of ids) {
    if (index.has(root)) {
      continue;
    }
    open(root);
    const frames: { node: string; edge: number }[] = [{ node: root, edge: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) {
        break;
      }
      const neighbours = graph.get(frame.node) ?? [];
      const next = neighbours[frame.edge];

      if (next !== undefined) {
        frame.edge += 1;
        if (!index.has(next)) {
          open(next);
          frames.push({ node: next, edge: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(required(low, frame.node), required(index, next)));
        }
        continue;
      }

      if (required(low, frame.node) === required(index, frame.node)) {
        const component: string[] = [];
        let popped: string | undefined;
        do {
          popped = stack.pop();
          if (popped === undefined) {
            break;
          }
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== frame.node);
        components.push(component);
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        low.set(parent.node, Math.min(required(low, parent.node), required(low, frame.node)));
      }
    }
  }

  return components;
}

function cyclePath(start: string, members: ReadonlySet<string>, graph: Graph): string[] {
  const path: string[] = [start];
  const visited = new Set<string>([start]);

  const walk = (node: string): boolean => {
    for (const next of graph.get(node) ?? []) {
      if (!members.has(next)) {
        continue;
      }
      if (next === start) {
        path.push(start);
        return true;
      }
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      path.push(next);
      if (walk(next)) {
        return true;
      }
      path.pop();
    }
    return false;
  };

  walk(start);
  return path;
}

function cycleDiagnostics(jobs: readonly Job[], graph: Graph, main: string): Diagnostic[] {
  const order = new Map(jobs.map((job, position) => [job.id, position]));
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const diagnostics: Diagnostic[] = [];

  for (const component of stronglyConnected(
    jobs.map((job) => job.id),
    graph,
  )) {
    const members = new Set(component);
    const selfLoop =
      component.length === 1 &&
      component[0] !== undefined &&
      (graph.get(component[0]) ?? []).includes(component[0]);

    if (component.length < 2 && !selfLoop) {
      continue;
    }

    const anchor = [...component].sort(
      (left, right) => required(order, left) - required(order, right),
    )[0];
    if (anchor === undefined) {
      continue;
    }

    diagnostics.push({
      code: NEEDS_CYCLE,
      severity: "error",
      params: { cycle: cyclePath(anchor, members, graph) },
      range: byId.get(anchor)?.range ?? null,
      // Le cycle est attribué au fichier du job qui l'ancre. Faute de ce job, au fichier principal :
      // il n'y a pas d'autre fichier à nommer, et un diagnostic sans fichier ne situe rien.
      file: byId.get(anchor)?.file ?? main,
    });
  }

  return diagnostics;
}

export function validate(pipeline: Pipeline): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const known = new Set(pipeline.jobs.map((job) => job.id));
  const byId = new Map(pipeline.jobs.map((job) => [job.id, job]));
  const stageOrder = new Map(pipeline.stages.map((stage, position) => [stage.name, position]));

  for (const job of pipeline.jobs) {
    if (!stageOrder.has(job.stage.value)) {
      diagnostics.push({
        code: UNKNOWN_STAGE,
        severity: "error",
        params: { job: job.id, stage: job.stage.value },
        range: job.range,
        file: job.file,
      });
    }

    for (const need of job.needs?.value ?? []) {
      const target = byId.get(need.job);
      if (target === undefined) {
        diagnostics.push({
          code: UNKNOWN_NEED,
          severity: "error",
          params: { job: job.id, need: need.job },
          range: job.range,
          file: job.file,
        });
        continue;
      }

      const from = stageOrder.get(job.stage.value);
      const to = stageOrder.get(target.stage.value);
      if (from !== undefined && to !== undefined && to > from) {
        diagnostics.push({
          code: NEED_LATER_STAGE,
          severity: "warning",
          params: {
            job: job.id,
            stage: job.stage.value,
            need: need.job,
            needStage: target.stage.value,
          },
          range: job.range,
          file: job.file,
        });
      }
    }
  }

  diagnostics.push(
    ...cycleDiagnostics(pipeline.jobs, buildGraph(pipeline.jobs, known), pipeline.main),
  );
  return diagnostics;
}
