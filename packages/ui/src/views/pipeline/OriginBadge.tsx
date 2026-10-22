import type { Origin } from "@keelson/core";
import { InheritedIcon } from "../../icons.tsx";
import { describeOrigin, ORIGIN_HINT } from "./origin.ts";

export type OriginBadgeProps = {
  origin: Origin;
};

export function OriginBadge({ origin }: OriginBadgeProps) {
  const described = describeOrigin(origin);
  if (described === null) {
    return null;
  }

  return (
    <span
      data-testid="origin-badge"
      title={ORIGIN_HINT}
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
