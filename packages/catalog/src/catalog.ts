import generated from "./generated/catalog.json" with { type: "json" };
import type { Tool } from "./schema.ts";

export type Logo = { path: string };

export type Catalog = {
  tools: readonly Tool[];
  logos: Readonly<Record<string, Logo>>;
};

/** Bundled in the package: `npx keelson` has neither `tools/` nor `simple-icons` at hand. */
export function loadCatalog(): Catalog {
  return generated as Catalog;
}
