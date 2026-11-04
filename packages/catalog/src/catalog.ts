import generated from "./generated/catalog.json" with { type: "json" };
import type { Tool } from "./schema.ts";

export type Logo = { title: string; path: string };

export type Catalog = {
  tools: readonly Tool[];
  logos: Readonly<Record<string, Logo>>;
};

/** Embarqué dans le paquet : `npx keelson` n'a ni `tools/` ni `simple-icons` sous la main. */
export function loadCatalog(): Catalog {
  return generated as Catalog;
}
