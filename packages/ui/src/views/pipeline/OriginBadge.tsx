import type { Origin } from "@keelson/core";
import { InheritedIcon } from "../../icons.tsx";
import { describeOrigin, hintFor } from "./origin.ts";

export type OriginBadgeProps = {
  origin: Origin;
  /** The job lives in an included file: the value cannot be overridden here. */
  readOnly?: boolean;
};

export function OriginBadge({ origin, readOnly = false }: OriginBadgeProps) {
  const described = describeOrigin(origin);
  if (described === null) {
    return null;
  }

  return (
    <span
      data-testid="origin-badge"
      title={hintFor(origin, readOnly)}
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-2xs font-medium text-text-muted"
    >
      <InheritedIcon />
      <span className="shrink-0 tracking-label uppercase">{described.label}</span>
      {described.source === null ? null : (
        <>
          {" "}
          <span className="truncate font-mono normal-case text-text-secondary">
            {described.source}
          </span>
        </>
      )}
    </span>
  );
}
