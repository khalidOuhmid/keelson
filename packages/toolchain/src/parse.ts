import type { Diagnostic, Toolchain } from "@keelson/core";
import {
  emptyToolchain,
  INTEGRATION_KINDS,
  isLegalServiceId,
  TOOLCHAIN_FILE,
  TOOLCHAIN_INVALID,
} from "@keelson/core";
import { isMap, isScalar, parseDocument } from "yaml";
import { z } from "zod";

const name = z.string().min(1);
const kind = z.enum(INTEGRATION_KINDS);

const schema = z.strictObject({
  version: z.literal(1),
  services: z
    .record(
      z.string(),
      z.strictObject({
        tool: name,
        url: name.nullable().optional(),
        environment: name.nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  integrations: z
    .array(z.strictObject({ job: name, service: name, kind }))
    .nullable()
    .optional(),
  dismissed: z
    .array(z.strictObject({ job: name, tool: name, kind }))
    .nullable()
    .optional(),
});

export type ParsedToolchain = { toolchain: Toolchain; diagnostics: Diagnostic[] };

function invalid(detail: string): ParsedToolchain {
  return {
    toolchain: emptyToolchain(),
    diagnostics: [
      {
        code: TOOLCHAIN_INVALID,
        severity: "error",
        params: { detail },
        range: null,
        file: TOOLCHAIN_FILE,
      },
    ],
  };
}

/** `text` nul veut dire que le fichier n'existe pas, ce qui est le cas normal. Un fichier invalide
 *  rend une toolchain vide : aucune opération ne l'éditera, et le diagnostic dit pourquoi. */
export function parseToolchain(text: string | null): ParsedToolchain {
  if (text === null) {
    return { toolchain: emptyToolchain(), diagnostics: [] };
  }

  const document = parseDocument(text);
  const failure = document.errors[0];
  if (failure !== undefined) {
    return invalid(failure.message);
  }
  if (document.contents === null) {
    return { toolchain: emptyToolchain(), diagnostics: [] };
  }

  // `toJS` ne rend pas une clé `__proto__` : c'est sur le document qu'on la voit.
  const services = isMap(document.contents) ? document.contents.get("services", true) : null;
  const illegal = isMap(services)
    ? services.items.find(
        (pair) => !isScalar(pair.key) || !isLegalServiceId(String(pair.key.value)),
      )
    : undefined;
  if (illegal !== undefined) {
    return invalid(`services: ${String(illegal.key)} is not a usable service id`);
  }

  // `toJS` lève sur un alias sans ancre : `parseDocument` ne le voit pas comme une erreur.
  let raw: unknown;
  try {
    raw = document.toJS({ mapAsMap: false });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "unreadable YAML");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    return invalid(`${path === "" ? "" : `${path}: `}${issue?.message ?? "invalid"}`);
  }

  return {
    toolchain: {
      services: Object.entries(parsed.data.services ?? {}).map(([id, service]) => ({
        id,
        tool: service.tool,
        url: service.url ?? null,
        environment: service.environment ?? null,
      })),
      integrations: parsed.data.integrations ?? [],
      dismissed: parsed.data.dismissed ?? [],
    },
    diagnostics: [],
  };
}
