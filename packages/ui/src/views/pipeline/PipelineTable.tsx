import type { Pipeline } from "@keelson/core";
import { LayerTags } from "../coverage/LayerTag.tsx";
import type { LayerOverlay } from "./graph.ts";

export type PipelineTableProps = {
  pipeline: Pipeline;
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  overlay?: LayerOverlay | null;
};

/** The graph's text equivalent: the same jobs, at the type ramp's own sizes whatever the zoom
 *  would have been, in stage order then file order. */
export function PipelineTable({
  pipeline,
  selectedJobId,
  onSelectJob,
  overlay = null,
}: PipelineTableProps) {
  const order = new Map(pipeline.stages.map((stage, index) => [stage.name, index]));
  const rank = (stage: string): number => order.get(stage) ?? pipeline.stages.length;
  const jobs = pipeline.jobs
    .map((job, index) => ({ job, index }))
    .sort(
      (left, right) =>
        rank(left.job.stage.value) - rank(right.job.stage.value) || left.index - right.index,
    )
    .map(({ job }) => job);

  const layersOf = (id: string) => {
    const layers = [...(overlay?.jobs.get(id) ?? [])];
    return layers.sort(
      (left, right) => Number(right === overlay?.selected) - Number(left === overlay?.selected),
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-surface-0 px-3 pb-3">
      {jobs.length === 0 ? (
        <p className="p-3 text-center text-sm text-text-muted">No jobs in this pipeline yet.</p>
      ) : (
        <table aria-label="Pipeline jobs" className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-surface-0 text-2xs font-semibold tracking-label text-text-muted uppercase">
            <tr className="border-b border-border-subtle">
              <th scope="col" className="py-1 font-semibold">
                Job
              </th>
              <th scope="col" className="px-2 py-1 font-semibold">
                {pipeline.provider === "github" ? "Level" : "Stage"}
              </th>
              <th scope="col" className="px-2 py-1 font-semibold">
                Needs
              </th>
              {overlay === null ? null : (
                <th scope="col" className="py-1 font-semibold">
                  Layers
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const needs = job.needs?.value ?? [];
              return (
                <tr key={job.id} className="border-b border-border-subtle align-top">
                  <td className="max-w-0 w-1/3 py-1">
                    <button
                      type="button"
                      data-job-id={job.id}
                      aria-pressed={job.id === selectedJobId}
                      onClick={() => onSelectJob(job.id)}
                      className="min-h-6 w-full cursor-pointer truncate rounded-sm px-1 text-left font-mono text-xs text-text-primary transition-colors duration-fast ease-out hover:bg-surface-2 aria-pressed:bg-surface-3 aria-pressed:font-semibold"
                    >
                      {job.id}
                    </button>
                  </td>
                  <td className="px-2 py-1 font-mono text-xs text-text-secondary">
                    {job.stage.value}
                  </td>
                  <td className="px-2 py-1 font-mono text-xs text-text-secondary">
                    {needs.length === 0 ? (
                      <span className="font-sans text-text-muted">None</span>
                    ) : (
                      needs
                        .map((need) => (need.optional ? `${need.job} (optional)` : need.job))
                        .join(", ")
                    )}
                  </td>
                  {overlay === null ? null : (
                    <td className="py-1">
                      <span className="flex flex-wrap items-center gap-1">
                        {layersOf(job.id).length === 0 ? (
                          <span className="text-xs text-text-muted">None</span>
                        ) : (
                          <LayerTags layers={layersOf(job.id)} />
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
