import type { Tool } from "@keelson/catalog";
import { isOpenSource } from "@keelson/catalog/licenses";
import type { LayerId } from "@keelson/taxonomy";

export type LicenseFilter = "any" | "open" | "other";
export type AdapterFilter = "any" | "gitlab" | "github";

export type CatalogFilter = {
  layer: LayerId | "any";
  license: LicenseFilter;
  adapter: AdapterFilter;
};

export function filterTools(tools: readonly Tool[], filter: CatalogFilter): Tool[] {
  return tools.filter(
    (tool) =>
      (filter.layer === "any" || tool.layers.includes(filter.layer)) &&
      (filter.license === "any" || isOpenSource(tool) === (filter.license === "open")) &&
      (filter.adapter === "any" || tool.snippets[filter.adapter] !== null),
  );
}
