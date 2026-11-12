import type { IntegrationKind, JobSignals } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
import type { Tool } from "./schema.ts";
import { executedCommands } from "./shell.ts";

export type Detection = {
  tool: string;
  layers: readonly LayerId[];
};

/** The defaults GitLab's Secure templates give the variables that name their analyzer images,
 *  as the templates write them. Any other variable stays unresolved. */
const TEMPLATE_VARIABLES: Readonly<Record<string, string>> = {
  CI_TEMPLATE_REGISTRY_HOST: "registry.gitlab.com",
  SECURE_ANALYZERS_PREFIX: "$CI_TEMPLATE_REGISTRY_HOST/security-products",
  CS_ANALYZER_IMAGE: "$CI_TEMPLATE_REGISTRY_HOST/security-products/container-scanning:8",
  APISEC_IMAGE: "api-security",
  DAST_API_IMAGE: "api-security",
};

const VARIABLE = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g;

function expand(image: string): string {
  let current = image;
  for (let round = 0; round < 3; round += 1) {
    const next = current.replace(
      VARIABLE,
      (written, braced: string | undefined, bare: string | undefined) =>
        TEMPLATE_VARIABLES[braced ?? bare ?? ""] ?? written,
    );
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

/** The repository path, without tag or digest. */
function segments(image: string): string[] {
  const parts = (image.toLowerCase().split("@")[0] ?? "").split("/");
  const last = parts.pop() ?? "";
  return [...parts, last.split(":")[0] ?? ""];
}

const isRegistry = (segment: string): boolean =>
  segment.includes(".") || segment.includes(":") || segment === "localhost";

/** A catalogue image written without its registry matches on its last name: a private mirror is
 *  still the same image, but `mycorp/trivy-report-uploader` is not Trivy. One written with its
 *  registry, as GitLab's analyzers are since their names are generic (`secrets`, `dast`), matches
 *  on its whole path under any registry. */
function sameImage(candidate: string, image: readonly string[]): boolean {
  const known = segments(candidate);
  if (known.length < 2 || !isRegistry(known[0] ?? "")) {
    return known.at(-1) === image.at(-1);
  }
  const path = known.slice(1);
  const tail = image.slice(image.length - path.length);
  return image.length > path.length && path.every((part, index) => part === tail[index]);
}

function onImage(tool: Tool, image: string | null): boolean {
  if (image === null) {
    return false;
  }
  const path = segments(expand(image));
  return tool.detect.images.some((candidate) => sameImage(candidate, path));
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
