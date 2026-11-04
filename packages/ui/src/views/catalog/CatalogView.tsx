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

  const shown = filterTools(catalog.tools, filter).sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base", numeric: true }),
  );
  const selected: Tool | undefined = catalog.tools.find((tool) => tool.id === selectedId);

  return (
    <div className="flex h-full min-h-0 max-lg:flex-col">
      <section aria-label="Tool catalogue" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <form className="grid shrink-0 grid-cols-3 gap-2 border-b border-border-subtle p-3 max-lg:grid-cols-1">
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

        <p
          data-testid="catalog-count"
          role="status"
          className="shrink-0 px-3 pt-2 text-xs text-text-muted"
        >
          {shown.length} of {catalog.tools.length} tools
        </p>

        {shown.length === 0 ? (
          <p className="p-3 text-sm text-text-muted">No tool matches these filters.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface-0 text-2xs font-semibold tracking-label text-text-muted uppercase">
                <tr className="border-b border-border-subtle">
                  <th scope="col" className="py-1 font-semibold">
                    Tool
                  </th>
                  <th scope="col" className="px-2 py-1 font-semibold">
                    Layers
                  </th>
                  <th scope="col" className="py-1 font-semibold">
                    License
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((tool) => (
                  <tr key={tool.id} className="border-b border-border-subtle">
                    <td className="max-w-0 w-1/2 py-1">
                      <button
                        type="button"
                        aria-pressed={tool.id === selectedId}
                        onClick={() => setSelectedId(tool.id)}
                        className="w-full cursor-pointer truncate rounded-sm px-1 py-1 text-left text-sm text-text-primary transition-colors duration-fast ease-out hover:bg-surface-2 aria-pressed:bg-surface-3 aria-pressed:font-semibold"
                      >
                        {tool.name}
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1">
                        <LayerTags layers={tool.layers} limit={2} />
                      </span>
                    </td>
                    <td className="py-1 font-mono text-2xs text-text-muted">{tool.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected === undefined ? null : (
        <aside
          aria-label="Tool"
          className="w-[var(--keelson-panel-width)] shrink-0 overflow-y-auto border-l border-border-subtle bg-surface-1 p-3 max-lg:fixed max-lg:inset-0 max-lg:z-20 max-lg:w-full"
        >
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
