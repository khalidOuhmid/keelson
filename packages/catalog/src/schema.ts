import { LAYER_IDS } from "@keelson/taxonomy";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const OPEN_SOURCE = [
  "AGPL-3.0-only",
  "Apache-2.0",
  "BSD-3-Clause",
  "GPL-2.0-only",
  "GPL-3.0-only",
  "LGPL-2.1-only",
  "LGPL-3.0-only",
  "MIT",
  "MPL-2.0",
] as const;

const NOT_OPEN_SOURCE = ["BUSL-1.1", "FSL-1.1-Apache-2.0", "Proprietary"] as const;

/** Compile à la validation : une regex invalide doit échouer ici, pas au moment de détecter. */
const pattern = z.string().refine((source) => {
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}, "not a valid regular expression");

export const toolSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  kind: z.enum(["job", "service"]),
  layers: z.array(z.enum(LAYER_IDS)).min(1),
  license: z.enum([...OPEN_SOURCE, ...NOT_OPEN_SOURCE]),
  homepage: z.url(),
  verifiedAt: z.url(),
  logo: z.string().min(1).nullable(),
  detect: z.strictObject({ images: z.array(z.string().min(1)), scripts: z.array(pattern) }),
  snippets: z.strictObject({ gitlab: z.string().nullable(), github: z.string().nullable() }),
  lastVerified: z.iso.date(),
});

export type Tool = z.infer<typeof toolSchema>;

export function isOpenSource(tool: Pick<Tool, "license">): boolean {
  return (OPEN_SOURCE as readonly string[]).includes(tool.license);
}

export type ParsedTool = { ok: true; tool: Tool } | { ok: false; detail: string };

/** `yaml` lit `2026-11-04` comme une chaîne, en mode `core` : aucune date ne se transforme. */
export function parseTool(text: string): ParsedTool {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "unreadable YAML" };
  }

  const parsed = toolSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, tool: parsed.data };
  }

  const issue = parsed.error.issues[0];
  const path = issue?.path.join(".") ?? "";
  return { ok: false, detail: `${path === "" ? "" : `${path}: `}${issue?.message ?? "invalid"}` };
}
