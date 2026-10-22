import type { Origin } from "@keelson/core";

export function describeOrigin(origin: Origin): string | null {
  switch (origin.kind) {
    case "local":
      return null;
    case "default":
      return "default";
    case "extends":
      return `inherited from ${origin.template}`;
    case "anchor":
      return `from anchor &${origin.name}`;
    case "reference":
      return `from !reference [${origin.path.join(", ")}]`;
  }
}

export const ORIGIN_HINT =
  "This value is inherited. Changing it writes an explicit override in this job and never touches the template.";
