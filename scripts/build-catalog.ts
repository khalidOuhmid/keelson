import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTool, type Tool } from "@keelson/catalog";
import * as icons from "simple-icons";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogRoot = join(repoRoot, "packages", "catalog");

type Icon = { slug: string; title: string; path: string };

const bySlug = new Map(
  Object.values(icons as unknown as Record<string, Icon>)
    .filter((icon) => typeof icon === "object" && icon.slug !== undefined)
    .map((icon) => [icon.slug, icon]),
);

export function buildCatalog(): string {
  const tools: Tool[] = readdirSync(join(catalogRoot, "tools"))
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => {
      const parsed = parseTool(readFileSync(join(catalogRoot, "tools", name), "utf8"));
      if (!parsed.ok) {
        throw new Error(`${name}: ${parsed.detail}`);
      }
      return parsed.tool;
    });

  const slugs = [
    ...new Set(tools.flatMap((tool) => (tool.logo === null ? [] : [tool.logo]))),
  ].sort();
  const logos = Object.fromEntries(
    slugs.map((slug) => {
      const icon = bySlug.get(slug);
      if (icon === undefined) {
        throw new Error(`no simple-icons logo named ${slug}`);
      }
      return [slug, { path: icon.path }];
    }),
  );

  return `${JSON.stringify({ tools, logos }, null, 2)}\n`;
}

if (import.meta.main) {
  writeFileSync(join(catalogRoot, "src", "generated", "catalog.json"), buildCatalog());
}
