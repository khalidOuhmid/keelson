import type { Origin } from "@keelson/core";
import { describeOrigin, ORIGIN_HINT } from "./origin.ts";

export type OriginBadgeProps = {
  origin: Origin;
};

export function OriginBadge({ origin }: OriginBadgeProps) {
  const label = describeOrigin(origin);
  if (label === null) {
    return null;
  }

  return (
    <span
      data-testid="origin-badge"
      title={ORIGIN_HINT}
      className="inline-flex max-w-full items-center gap-1 truncate rounded-sm border border-border-default bg-surface-3 px-1 text-2xs font-medium tracking-label whitespace-nowrap text-text-secondary uppercase"
    >
      <span aria-hidden="true">↳</span>
      {label}
    </span>
  );
}
