import { INTEGRATION_KINDS } from "@keelson/core";
import { LAYER_IDS } from "@keelson/taxonomy";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { OPEN_SOURCE_LICENSES, OTHER_LICENSES } from "./licenses.ts";

/** Compile à la validation : une regex invalide doit échouer ici, pas au moment de détecter. */
const pattern = z.string().refine((source) => {
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}, "not a valid regular expression");

function yamlOf(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

function isJobMap(text: string): boolean {
  const value = yamlOf(text);
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStepList(text: string): boolean {
  const value = yamlOf(text);
  return Array.isArray(value) && value.length > 0;
}

export const toolSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    kind: z.enum(["job", "service"]),
    layers: z.array(z.enum(LAYER_IDS)).min(1),
    license: z.enum([...OPEN_SOURCE_LICENSES, ...OTHER_LICENSES]),
    homepage: z.url(),
    verifiedAt: z.url(),
    logo: z.string().min(1).nullable(),
    detect: z.strictObject({
      images: z.array(z.string().min(1)),
      scripts: z.array(pattern),
      /** Les actions GitHub officielles de l'outil, sans leur `@ref`. */
      actions: z.array(z.string().min(1)).default([]),
    }),
    snippets: z.strictObject({
      gitlab: z.string().refine(isJobMap, "not a map of jobs").nullable(),
      github: z.string().refine(isStepList, "not a list of steps").nullable(),
    }),
    lastVerified: z.iso.date(),
    /** Le type d'intégration qu'un job a avec ce service. Absent sur les outils de type `job`. */
    integration: z.enum(INTEGRATION_KINDS).nullable().default(null),
  })
  .refine((tool) => tool.kind === "service" || tool.integration === null, {
    path: ["integration"],
    message: "only a service has an integration",
  });

export type Tool = z.infer<typeof toolSchema>;

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
