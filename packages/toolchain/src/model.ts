import type { Toolchain, ToolchainOperation } from "@keelson/core";

const nothingAt = -1;

/** What an operation must produce, computed without going through the text. The in-place patch
 *  does not know every hand-written YAML form: reading the result back and comparing it with this
 *  rejects a wrong write wherever it would have touched something other than its target. */
export function expectedToolchain(
  model: Toolchain,
  operation: Exclude<ToolchainOperation, { kind: "splice" }>,
): Toolchain {
  switch (operation.kind) {
    case "addService": {
      const { id, tool, url, environment } = operation;
      return { ...model, services: [...model.services, { id, tool, url, environment }] };
    }
    case "updateService":
      return {
        ...model,
        services: model.services.map((service) =>
          service.id === operation.id
            ? {
                ...service,
                tool: operation.tool ?? service.tool,
                url: operation.url === undefined ? service.url : operation.url,
                environment:
                  operation.environment === undefined ? service.environment : operation.environment,
              }
            : service,
        ),
      };
    case "removeService":
      return {
        ...model,
        services: model.services.filter((service) => service.id !== operation.id),
      };
    case "addIntegration": {
      const { job, service, integration: kind } = operation;
      return { ...model, integrations: [...model.integrations, { job, service, kind }] };
    }
    case "removeIntegration": {
      const position = model.integrations.findIndex(
        (entry) =>
          entry.job === operation.job &&
          entry.service === operation.service &&
          entry.kind === operation.integration,
      );
      return position === nothingAt
        ? model
        : { ...model, integrations: model.integrations.toSpliced(position, 1) };
    }
    case "dismissIntegration": {
      const { job, tool, integration: kind } = operation;
      return { ...model, dismissed: [...model.dismissed, { job, tool, kind }] };
    }
    case "restoreIntegration": {
      const position = model.dismissed.findIndex(
        (entry) =>
          entry.job === operation.job &&
          entry.tool === operation.tool &&
          entry.kind === operation.integration,
      );
      return position === nothingAt
        ? model
        : { ...model, dismissed: model.dismissed.toSpliced(position, 1) };
    }
  }
}
