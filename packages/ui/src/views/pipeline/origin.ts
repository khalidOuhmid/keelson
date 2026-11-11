import type { Origin } from "@keelson/core";

/** `label` is Keelson's voice, `source` a string taken from the user's file. The two are kept apart
 *  because they are not typeset the same way: the label is set in small caps, the source never — a
 *  GitLab template key is case-sensitive, and `.deploy-base` shown as `.DEPLOY-BASE` is data
 *  rewritten on screen. */
export type OriginLabel = {
  label: string;
  source: string | null;
};

export function describeOrigin(origin: Origin): OriginLabel | null {
  switch (origin.kind) {
    case "local":
      return null;
    case "default":
      return { label: "default", source: null };
    case "extends":
      return { label: "inherited from", source: origin.template };
    case "anchor":
      return { label: "from anchor", source: `&${origin.name}` };
    case "reference":
      return { label: "from reference", source: `[${origin.path.join(", ")}]` };
    case "include":
      return { label: "from included file", source: origin.file };
  }
}

export const ORIGIN_HINT =
  "This value is inherited. Changing it writes an explicit override in this job and never touches the template.";

/** A value coming from an included file, on a job of the main file: `setJobStage` does write an
 *  override there, and the included file is not touched. */
export const INCLUDE_ORIGIN_HINT =
  "This value comes from an included file. Changing it writes an explicit override in this job and never touches that file.";

/** On an included job, no value can be overridden, whatever its origin: Keelson does not write
 *  that file. */
export const READ_ONLY_ORIGIN_HINT =
  "This job is defined in an included file. Keelson never writes to included files, so this value cannot be overridden here.";

/** The text depends on the job **and** the origin: looking at the origin alone promised an
 *  impossible override on an included job, or refused it on a job overridden in the main file. */
export function hintFor(origin: Origin, readOnly: boolean): string {
  if (readOnly) {
    return READ_ONLY_ORIGIN_HINT;
  }
  return origin.kind === "include" ? INCLUDE_ORIGIN_HINT : ORIGIN_HINT;
}
