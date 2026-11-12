import type { Diagnostic, Toolchain } from "@keelson/core";
import {
  emptyToolchain,
  INTEGRATION_KINDS,
  isLegalServiceId,
  TOOLCHAIN_FILE,
  TOOLCHAIN_INVALID,
} from "@keelson/core";
import { type Document, isMap, isScalar, type Node, parseDocument } from "yaml";
import { z } from "zod";

const name = z.string().min(1);
const kind = z.enum(INTEGRATION_KINDS);

const service = z.strictObject({
  tool: name,
  url: name.nullable().optional(),
  environment: name.nullable().optional(),
});

const schema = z.strictObject({
  version: z.literal(1),
  services: z.record(z.string(), z.unknown()).nullable().optional(),
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

/** The key as written: `toJS` reads `007:` as 7 and `0x10:` as 16; a quoted key keeps its value. */
export function keyText(key: unknown): string {
  if (isScalar(key)) {
    return key.type === "PLAIN" && typeof key.source === "string" ? key.source : String(key.value);
  }
  return String(key);
}

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

function issueText(error: z.ZodError, prefix: readonly string[]): string {
  const issue = error.issues[0];
  const path = [...prefix, ...(issue?.path ?? []).map(String)].join(".");
  return `${path === "" ? "" : `${path}: `}${issue?.message ?? "invalid"}`;
}

function serviceValue(document: Document, node: Node | null): unknown {
  return node === null ? null : node.toJS(document, { mapAsMap: false });
}

/** A null `text` means the file does not exist, which is the normal case. An invalid file yields an
 *  empty toolchain: no operation will edit it, and the diagnostic says why. */
export function parseToolchain(text: string | null): ParsedToolchain {
  if (text === null) {
    return { toolchain: emptyToolchain(), diagnostics: [] };
  }

  const document = parseDocument(text, {
    uniqueKeys: (left, right) => keyText(left) === keyText(right),
  });
  const failure = document.errors[0];
  if (failure !== undefined) {
    return invalid(failure.message);
  }
  if (document.contents === null) {
    return { toolchain: emptyToolchain(), diagnostics: [] };
  }

  // `toJS` drops a `__proto__` key and merges `7:` with `007:`: services are read from the pairs.
  const services = isMap(document.contents) ? document.contents.get("services", true) : null;
  const pairs = isMap(services) ? services.items : [];
  const illegal = pairs.find((pair) => !isScalar(pair.key) || !isLegalServiceId(keyText(pair.key)));
  if (illegal !== undefined) {
    return invalid(`services: ${keyText(illegal.key)} is not a usable service id`);
  }
  const keys = pairs.map((pair) => keyText(pair.key));

  // `toJS` throws on an alias without an anchor: `parseDocument` does not see it as an error.
  let raw: unknown;
  let values: unknown[];
  try {
    raw = document.toJS({ mapAsMap: false });
    values = pairs.map((pair) => serviceValue(document, pair.value as Node | null));
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "unreadable YAML");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return invalid(issueText(parsed.error, []));
  }

  const read: Toolchain["services"] = [];
  for (const [position, id] of keys.entries()) {
    const checked = service.safeParse(values[position]);
    if (!checked.success) {
      return invalid(issueText(checked.error, ["services", id]));
    }
    read.push({
      id,
      tool: checked.data.tool,
      url: checked.data.url ?? null,
      environment: checked.data.environment ?? null,
    });
  }

  return {
    toolchain: {
      services: read,
      integrations: parsed.data.integrations ?? [],
      dismissed: parsed.data.dismissed ?? [],
    },
    diagnostics: [],
  };
}
