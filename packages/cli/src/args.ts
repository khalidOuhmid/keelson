import { type ParseArgsConfig, parseArgs } from "node:util";

export type ArgSpec = {
  options: NonNullable<ParseArgsConfig["options"]>;
  allowPositionals?: boolean;
};

export type ArgsResult<V> =
  | { ok: true; values: V; positionals: string[] }
  | { ok: false; message: string };

export function parseCommandArgs<V extends Record<string, unknown>>(
  argv: readonly string[],
  spec: ArgSpec,
): ArgsResult<V> {
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: spec.options,
      allowPositionals: spec.allowPositionals ?? false,
      strict: true,
    });
    return {
      ok: true,
      values: parsed.values as V,
      positionals: [...parsed.positionals],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message === "" ? "invalid arguments" : message };
  }
}
