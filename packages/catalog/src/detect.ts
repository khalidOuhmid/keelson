import type { JobSignals } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
import type { Tool } from "./schema.ts";

export type Detection = {
  tool: string;
  layers: readonly LayerId[];
};

/** Le nom d'une image sans registre, chemin, tag ni empreinte : un miroir privé reste la même image,
 *  mais `mycorp/trivy-report-uploader` n'est pas Trivy. */
function imageName(image: string): string {
  const withoutDigest = image.toLowerCase().split("@")[0] ?? "";
  const last = withoutDigest.split("/").at(-1) ?? "";
  return last.split(":")[0] ?? "";
}

function onImage(tool: Tool, image: string | null): boolean {
  const name = image === null ? null : imageName(image);
  return name !== null && tool.detect.images.some((candidate) => imageName(candidate) === name);
}

/** Commandes qui nomment un fichier ou un mot sans rien exécuter : `cp renovate.json /tmp`, un
 *  `echo` ou un commentaire ne prouvent pas qu'un outil tourne. */
const INERT = new Set([
  "cat",
  "cd",
  "chmod",
  "chown",
  "cp",
  "echo",
  "export",
  "grep",
  "kubectl",
  "ls",
  "mkdir",
  "mv",
  "printf",
  "rm",
  "sed",
  "tee",
  "touch",
]);

function commands(script: readonly string[]): string[] {
  return script
    .flatMap((line) => line.split(/\n|&&|\|\||;|\|/))
    .map((command) => command.trim())
    .filter((command) => {
      const first = command.split(/\s+/)[0] ?? "";
      return command !== "" && !first.startsWith("#") && !INERT.has(first);
    });
}

function onScript(tool: Tool, script: readonly string[]): boolean {
  const patterns = tool.detect.scripts.map((source) => new RegExp(source, "i"));
  return commands(script).some((command) => patterns.some((pattern) => pattern.test(command)));
}

/** Un job peut correspondre à plusieurs outils. */
export function detectTools(signals: JobSignals, tools: readonly Tool[]): Detection[] {
  return tools.flatMap((tool): Detection[] =>
    onImage(tool, signals.image) || onScript(tool, signals.script)
      ? [{ tool: tool.id, layers: tool.layers }]
      : [],
  );
}
