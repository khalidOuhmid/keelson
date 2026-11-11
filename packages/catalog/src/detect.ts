import type { IntegrationKind, JobSignals } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
import type { Tool } from "./schema.ts";
import { executedCommands } from "./shell.ts";

export type Detection = {
  tool: string;
  layers: readonly LayerId[];
};

/** An image name without registry, path, tag or digest: a private mirror is still the same image,
 *  but `mycorp/trivy-report-uploader` is not Trivy. */
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

const DOCKER = "docker://";

function onNamedAction(tool: Tool, actions: readonly string[]): boolean {
  return actions.some((action) => {
    const name = (action.split("@")[0] ?? "").toLowerCase();
    return tool.detect.actions.some(
      (known) => name === known.toLowerCase() || name.startsWith(`${known.toLowerCase()}/`),
    );
  });
}

function onAction(tool: Tool, actions: readonly string[]): boolean {
  return (
    onNamedAction(tool, actions) ||
    actions.some(
      (action) => action.startsWith(DOCKER) && onImage(tool, action.slice(DOCKER.length)),
    )
  );
}

const commandsOf = (signals: JobSignals): string[] =>
  signals.script.flatMap((line) => executedCommands(line));

export type DetectedIntegration = { tool: string; kind: IntegrationKind };

/** On the script or the service's own action: a client image does not prove that a job talks to
 *  the service, `docker://` included. */
export function detectIntegrations(
  signals: JobSignals,
  tools: readonly Tool[],
): DetectedIntegration[] {
  const commands = commandsOf(signals);
  return tools.flatMap((tool): DetectedIntegration[] =>
    tool.integration !== null &&
    (onScript(tool, commands) || onNamedAction(tool, signals.actions ?? []))
      ? [{ tool: tool.id, kind: tool.integration }]
      : [],
  );
}

/** A job can match several tools. */
export function detectTools(signals: JobSignals, tools: readonly Tool[]): Detection[] {
  const commands = commandsOf(signals);
  return tools.flatMap((tool): Detection[] =>
    onImage(tool, signals.image) ||
    onScript(tool, commands) ||
    onAction(tool, signals.actions ?? [])
      ? [{ tool: tool.id, layers: tool.layers }]
      : [],
  );
}
