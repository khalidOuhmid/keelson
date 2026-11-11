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

/** A null `text` means the file does not exist, which is the normal case. An invalid file yields an
 *  empty toolchain: no operation will edit it, and the diagnostic says why. */
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

  // `toJS` does not return a `__proto__` key: it is visible on the document.
  const services = isMap(document.contents) ? document.contents.get("services", true) : null;
  const illegal = isMap(services)
    ? services.items.find(
        (pair) => !isScalar(pair.key) || !isLegalServiceId(String(pair.key.value)),
      )
    : undefined;
  if (illegal !== undefined) {
    return invalid(`services: ${String(illegal.key)} is not a usable service id`);
  }
  // `8080:` and `"8080":` are two keys for `yaml`, and a single one once in an object.
  const keys = isMap(services) ? services.items.map((pair) => String(pair.key)) : [];
  const repeated = keys.find((key, position) => keys.indexOf(key) !== position);
  if (repeated !== undefined) {
    return invalid(`services: ${repeated} is declared twice`);
  }

  // `toJS` throws on an alias without an anchor: `parseDocument` does not see it as an error.
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
