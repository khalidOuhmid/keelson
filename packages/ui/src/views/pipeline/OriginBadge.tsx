import type { Origin } from "@keelson/core";
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
      <InheritedMark />
      <span className="shrink-0 tracking-label uppercase">{described.label}</span>
      {described.source === null ? null : (
        <>
          {" "}
          <span className="truncate font-mono text-text-secondary">{described.source}</span>
        </>
      )}
    </span>
  );
}

/** Marque d'héritage. Un SVG en ligne plutôt que le caractère `↳`, dont le rendu dépend de la
 *  police du système et que DESIGN.md refuse de canoniser. */
function InheritedMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M3 2v4.5a1.5 1.5 0 0 0 1.5 1.5H9" />
      <path d="M7 6l2 2-2 2" />
    </svg>
  );
}
