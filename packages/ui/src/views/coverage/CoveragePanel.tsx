import type { Coverage, LayerCoverage } from "@keelson/catalog";
import { findLayer, type LayerId } from "@keelson/taxonomy";
import { SECTION_HEADING } from "../../editing/controls.ts";
import { LayerTag } from "./LayerTag.tsx";

export const GUIDELINE_ROOT = "https://github.com/OWASP/DevSecOpsGuideline/blob/main/";

export const LOWER_BOUND_NOTE =
  "Coverage is a lower bound: some includes are not resolved, and a layer listed as uncovered may be covered by what Keelson cannot read.";

export type CoveragePanelProps = {
  coverage: Coverage;
  selected: LayerId | null;
  onSelect: (layer: LayerId) => void;
  onShowTools: (layer: LayerId) => void;
};

function Uncovered({
  entry,
  onShowTools,
}: {
  entry: LayerCoverage;
  onShowTools: (layer: LayerId) => void;
}) {
  const layer = findLayer(entry.layer);
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <LayerTag layer={layer.id} />
        <span className="text-sm text-text-primary">{layer.name}</span>
      </span>
      <p className="text-sm text-text-secondary">{layer.summary}</p>
      <span className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => onShowTools(layer.id)}
          className="cursor-pointer text-accent underline underline-offset-2"
        >
          See tools
        </button>
        {layer.guideline === null ? null : (
          <a
            href={`${GUIDELINE_ROOT}${layer.guideline}`}
            target="_blank"
            rel="noreferrer"
            className="text-text-secondary underline underline-offset-2"
          >
            OWASP guideline
          </a>
        )}
      </span>
    </li>
  );
}

export function CoveragePanel({ coverage, selected, onSelect, onShowTools }: CoveragePanelProps) {
  const uncovered = coverage.layers.filter((entry) => !entry.covered);
  const covered = coverage.layers.filter((entry) => entry.covered);

  return (
    <div className="flex flex-col gap-4">
      <p data-testid="coverage-count" className="text-sm text-text-secondary">
        {covered.length} of {coverage.layers.length} layers covered
      </p>

      {coverage.partial ? (
        <p data-testid="coverage-lower-bound" className="text-sm text-text-secondary">
          {LOWER_BOUND_NOTE}
        </p>
      ) : null}

      <section aria-label="Uncovered layers" className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>Uncovered layers</h2>
        {uncovered.length === 0 ? (
          <p className="text-sm text-text-muted">Every layer has at least one job.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {uncovered.map((entry) => (
              <Uncovered key={entry.layer} entry={entry} onShowTools={onShowTools} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Covered layers" className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>Covered layers</h2>
        {covered.length === 0 ? (
          <p className="text-sm text-text-muted">No job matches a layer yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {covered.map((entry) => (
              <li key={entry.layer}>
                <button
                  type="button"
                  aria-pressed={selected === entry.layer}
                  onClick={() => onSelect(entry.layer)}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm border border-transparent px-1 py-1 text-left transition-colors duration-fast ease-out hover:bg-surface-3 aria-pressed:border-accent"
                >
                  <LayerTag layer={entry.layer} />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                    {findLayer(entry.layer).name}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-text-muted tabular-nums">
                    {entry.jobs.length} {entry.jobs.length === 1 ? "job" : "jobs"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
