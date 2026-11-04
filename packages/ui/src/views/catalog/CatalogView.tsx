import type { Tool } from "@keelson/catalog";
import type { LayerId } from "@keelson/taxonomy";
import { useState } from "react";
import type { CatalogPayload } from "../../api/client.ts";
import { FIELD, GROUP, LABEL } from "../../editing/controls.ts";
import { LayerTags } from "../coverage/LayerTag.tsx";
import {
  type AdapterFilter,
  type CatalogFilter,
  filterTools,
  type LicenseFilter,
} from "./filter.ts";
import { ToolCard } from "./ToolCard.tsx";

export type CatalogViewProps = {
  catalog: CatalogPayload;
  initialLayer: LayerId | null;
};

export function CatalogView({ catalog, initialLayer }: CatalogViewProps) {
  const [filter, setFilter] = useState<CatalogFilter>({
    layer: initialLayer ?? "any",
    license: "any",
    adapter: "any",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const shown = filterTools(catalog.tools, filter);
  const selected: Tool | undefined = catalog.tools.find((tool) => tool.id === selectedId);

  return (
    <div className="flex h-full min-h-0 max-lg:flex-col">
      <section aria-label="Tool catalogue" className="flex min-w-0 flex-1 flex-col">
        <form className="grid shrink-0 grid-cols-3 gap-2 border-b border-border-subtle p-3">
          <label className={GROUP}>
            <span className={LABEL}>Layer</span>
            <select
              className={FIELD}
              value={filter.layer}
              onChange={(event) =>
                setFilter({ ...filter, layer: event.target.value as CatalogFilter["layer"] })
              }
            >
              <option value="any">All layers</option>
              {catalog.layers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
            </select>
          </label>
          <label className={GROUP}>
            <span className={LABEL}>License</span>
            <select
              className={FIELD}
              value={filter.license}
              onChange={(event) =>
                setFilter({ ...filter, license: event.target.value as LicenseFilter })
              }
            >
              <option value="any">Any license</option>
              <option value="open">Open source</option>
              <option value="other">Source-available or commercial</option>
            </select>
          </label>
          <label className={GROUP}>
            <span className={LABEL}>Adapter</span>
            <select
              className={FIELD}
              value={filter.adapter}
              onChange={(event) =>
                setFilter({ ...filter, adapter: event.target.value as AdapterFilter })
              }
            >
              <option value="any">Any adapter</option>
              <option value="gitlab">GitLab CI snippet</option>
              <option value="github">GitHub Actions snippet</option>
            </select>
          </label>
        </form>

        <p data-testid="catalog-count" className="shrink-0 px-3 pt-2 text-xs text-text-muted">
          {shown.length} of {catalog.tools.length} tools
        </p>

        {shown.length === 0 ? (
          <p className="p-3 text-sm text-text-muted">No tool matches these filters.</p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
            {shown.map((tool) => (
              <li key={tool.id} className="border-b border-border-subtle last:border-b-0">
                <button
                  type="button"
                  aria-pressed={tool.id === selectedId}
                  onClick={() => setSelectedId(tool.id)}
                  className="flex w-full cursor-pointer items-center gap-2 overflow-hidden px-1 py-2 text-left transition-colors duration-fast ease-out hover:bg-surface-2 aria-pressed:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                    {tool.name}
                  </span>
                  <LayerTags layers={tool.layers} limit={2} />
                  <span className="shrink-0 font-mono text-2xs text-text-muted">
                    {tool.license}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected === undefined ? null : (
        <aside className="w-[var(--keelson-panel-width)] shrink-0 overflow-y-auto border-l border-border-subtle bg-surface-1 p-3 max-lg:fixed max-lg:inset-0 max-lg:z-20 max-lg:w-full">
          <ToolCard
            key={selected.id}
            tool={selected}
            logo={selected.logo === null ? null : (catalog.logos[selected.logo] ?? null)}
            onClose={() => setSelectedId(null)}
          />
        </aside>
      )}
    </div>
  );
}
