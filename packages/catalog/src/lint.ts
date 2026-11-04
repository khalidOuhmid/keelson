import type { Diagnostic } from "@keelson/core";
import {
  CATALOG_DUPLICATE_TOOL,
  CATALOG_INVALID_TOOL,
  CATALOG_MISSING_SNIPPET,
  CATALOG_STALE_TOOL,
  CATALOG_UNKNOWN_LOGO,
} from "@keelson/core";
import type { Logo } from "./catalog.ts";
import { parseTool } from "./schema.ts";

export const STALE_AFTER_MONTHS = 6;

export type ToolFile = { file: string; text: string };

function isStale(lastVerified: string, now: Date): boolean {
  const limit = new Date(now);
  limit.setUTCMonth(limit.getUTCMonth() - STALE_AFTER_MONTHS);
  return new Date(`${lastVerified}T00:00:00Z`) < limit;
}

export function lintCatalog(
  files: readonly ToolFile[],
  logos: Readonly<Record<string, Logo>>,
  now: Date,
): Diagnostic[] {
  const seen = new Set<string>();

  return files.flatMap(({ file, text }): Diagnostic[] => {
    const at = { range: null, file };
    const parsed = parseTool(text);
    if (!parsed.ok) {
      return [
        {
          code: CATALOG_INVALID_TOOL,
          severity: "error",
          params: { detail: parsed.detail },
          ...at,
        },
      ];
    }

    const { tool } = parsed;
    const found: Diagnostic[] = [];
    if (seen.has(tool.id)) {
      found.push({
        code: CATALOG_DUPLICATE_TOOL,
        severity: "error",
        params: { tool: tool.id },
        ...at,
      });
    }
    seen.add(tool.id);

    if (tool.logo !== null && !Object.hasOwn(logos, tool.logo)) {
      found.push({
        code: CATALOG_UNKNOWN_LOGO,
        severity: "error",
        params: { tool: tool.id, logo: tool.logo },
        ...at,
      });
    }
    if (tool.kind === "job" && tool.snippets.gitlab === null && tool.snippets.github === null) {
      found.push({
        code: CATALOG_MISSING_SNIPPET,
        severity: "error",
        params: { tool: tool.id },
        ...at,
      });
    }
    if (isStale(tool.lastVerified, now)) {
      found.push({
        code: CATALOG_STALE_TOOL,
        severity: "warning",
        params: { tool: tool.id, lastVerified: tool.lastVerified },
        ...at,
      });
    }
    return found;
  });
}
