import type { IntegrationKind, JobSignals } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
import type { Tool } from "./schema.ts";
import { executedCommands } from "./shell.ts";

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

function onScript(tool: Tool, commands: readonly string[]): boolean {
  const patterns = tool.detect.scripts.map((source) => new RegExp(source, "i"));
  return commands.some((command) => patterns.some((pattern) => pattern.test(command)));
}

/** `owner/repo` et ses sous-chemins (`github/codeql-action/init`), jamais un autre dépôt qui
 *  commencerait par le même nom. */
function onAction(tool: Tool, actions: readonly string[] = []): boolean {
  const names = (tool.detect.actions ?? []).map((name) => name.toLowerCase());
  return actions.some((action) => {
    const called = action.toLowerCase();
    return names.some((name) => called === name || called.startsWith(`${name}/`));
  });
}

const commandsOf = (signals: JobSignals): string[] =>
  signals.script.flatMap((line) => executedCommands(line));

export type DetectedIntegration = { tool: string; kind: IntegrationKind };

/** Sur le script et les actions : l'image d'un client ne prouve pas qu'un job parle au service. */
export function detectIntegrations(
  signals: JobSignals,
  tools: readonly Tool[],
): DetectedIntegration[] {
  const commands = commandsOf(signals);
  return tools.flatMap((tool): DetectedIntegration[] =>
    tool.integration !== null && (onScript(tool, commands) || onAction(tool, signals.actions))
      ? [{ tool: tool.id, kind: tool.integration }]
      : [],
  );
}

/** Un job peut correspondre à plusieurs outils. */
export function detectTools(signals: JobSignals, tools: readonly Tool[]): Detection[] {
  const commands = commandsOf(signals);
  return tools.flatMap((tool): Detection[] =>
    onImage(tool, signals.image) || onScript(tool, commands) || onAction(tool, signals.actions)
      ? [{ tool: tool.id, layers: tool.layers }]
      : [],
  );
}
