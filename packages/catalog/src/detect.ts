import type { JobSignals } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
import type { Tool } from "./schema.ts";

export type Detection = {
  tool: string;
  layers: readonly LayerId[];
  via: "image" | "script";
};

function onImage(tool: Tool, image: string | null): boolean {
  const lowered = image?.toLowerCase();
  return lowered !== undefined && tool.detect.images.some((name) => lowered.includes(name));
}

function onScript(tool: Tool, script: readonly string[]): boolean {
  const patterns = tool.detect.scripts.map((source) => new RegExp(source, "i"));
  return script.some((line) => patterns.some((pattern) => pattern.test(line)));
}

/** Une image l'emporte sur un script : elle dit quel outil tourne, une ligne de script seulement
 *  qu'un mot lui ressemble. Un job peut correspondre à plusieurs outils. */
export function detectTools(signals: JobSignals, tools: readonly Tool[]): Detection[] {
  return tools.flatMap((tool): Detection[] => {
    const via = onImage(tool, signals.image)
      ? "image"
      : onScript(tool, signals.script)
        ? "script"
        : null;
    return via === null ? [] : [{ tool: tool.id, layers: tool.layers, via }];
  });
}
