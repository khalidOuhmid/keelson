import type { Tool } from "@keelson/catalog";
import { isOpenSource } from "@keelson/catalog/licenses";
import { findLayer, type LayerId } from "@keelson/taxonomy";

export type LicenseFilter = "any" | "open" | "other";
export type AdapterFilter = "any" | "gitlab" | "github";

export type CatalogFilter = {
  layer: LayerId | "any";
  license: LicenseFilter;
  adapter: AdapterFilter;
  /** Free text, matched against the name, the id, the layers and the licence. */
  query?: string;
};

function matches(tool: Tool, query: string): boolean {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const text = [
    tool.name,
    tool.id,
    tool.license,
    ...tool.layers.flatMap((layer) => [layer, findLayer(layer).name]),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

export function filterTools(tools: readonly Tool[], filter: CatalogFilter): Tool[] {
  return tools.filter(
    (tool) =>
      (filter.layer === "any" || tool.layers.includes(filter.layer)) &&
      (filter.license === "any" || isOpenSource(tool) === (filter.license === "open")) &&
      (filter.adapter === "any" || tool.snippets[filter.adapter] !== null) &&
      matches(tool, filter.query ?? ""),
  );
}
