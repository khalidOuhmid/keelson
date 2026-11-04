import type { Coverage, LayerCoverage } from "@keelson/catalog";
import { findLayer, type LayerId, type LayerSource } from "@keelson/taxonomy";
import { SECTION_HEADING } from "../../editing/controls.ts";
import { LayerTag } from "./LayerTag.tsx";

export const GUIDELINE_ROOT = "https://github.com/OWASP/DevSecOpsGuideline/blob/master/";

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
  const ofSource = (source: LayerSource) =>
    coverage.layers.filter((entry) => findLayer(entry.layer).source === source);
  const owasp = ofSource("owasp");
  const platform = ofSource("platform");
  const seen = (entries: readonly LayerCoverage[]) => entries.filter((entry) => entry.covered);
  const uncovered = owasp.filter((entry) => !entry.covered);
  const unseen = platform.filter((entry) => !entry.covered);
  const covered = coverage.layers.filter((entry) => entry.covered);

  return (
    <div className="flex flex-col gap-4">
      <p data-testid="coverage-count" className="text-sm text-text-secondary">
        {seen(owasp).length} of {owasp.length} OWASP layers covered, {seen(platform).length} of{" "}
        {platform.length} platform categories seen
      </p>

      {coverage.partial ? (
        <p data-testid="coverage-lower-bound" className="text-sm text-text-secondary">
          {LOWER_BOUND_NOTE}
        </p>
      ) : null}

      <div role="group" aria-label="Uncovered OWASP layers" className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>Uncovered OWASP layers</h2>
        {uncovered.length === 0 ? (
          <p className="text-sm text-text-muted">Every OWASP layer has at least one job.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {uncovered.map((entry) => (
              <Uncovered key={entry.layer} entry={entry} onShowTools={onShowTools} />
            ))}
          </ul>
        )}
      </div>

      {/* Une catégorie plateforme est un service autour du pipeline : ne pas la voir dans les jobs
          n'est pas une lacune de sécurité, et la mêler aux couches OWASP gonflait le manque. */}
      <div role="group" aria-label="Platform categories not seen" className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>Platform categories not seen</h2>
        {unseen.length === 0 ? (
          <p className="text-sm text-text-muted">Every category appears in a job.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {unseen.map((entry) => (
              <Uncovered key={entry.layer} entry={entry} onShowTools={onShowTools} />
            ))}
          </ul>
        )}
      </div>

      <div role="group" aria-label="Covered layers" className="flex flex-col gap-2">
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
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-text-secondary">
                      {findLayer(entry.layer).name}
                    </span>
                    <span className="truncate font-mono text-2xs text-text-muted">
                      {entry.jobs.join(", ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
