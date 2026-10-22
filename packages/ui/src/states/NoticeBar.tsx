import type { Notice } from "../state/store.ts";

const LABEL: Record<Notice["kind"], string> = {
  stale: "Not applied",
  reloaded: "Reloaded",
  removed: "Deleted",
};

const TONE: Record<Notice["kind"], string> = {
  stale: "border-warning-muted bg-warning-muted/20 text-warning",
  reloaded: "border-info-muted bg-info-muted/20 text-info",
  removed: "border-danger-muted bg-danger-muted/20 text-danger",
};

export type NoticeBarProps = {
  notice: Notice | null;
  onDismiss: () => void;
};

export function NoticeBar({ notice, onDismiss }: NoticeBarProps) {
  if (notice === null) {
    return null;
  }

  const consequential = notice.kind !== "reloaded";

  return (
    <div
      {...(consequential ? { role: "alert" } : { role: "status", "aria-live": "polite" as const })}
      className={`flex items-center gap-2 border-b px-3 py-1.5 ${TONE[notice.kind]}`}
    >
      <span
        data-testid="notice-kind"
        className="shrink-0 rounded-sm border border-current px-1 text-2xs font-semibold tracking-label uppercase"
      >
        {LABEL[notice.kind]}
      </span>
      <p className="min-w-0 flex-1 text-sm text-text-primary">{notice.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 cursor-pointer rounded-sm border border-border-default px-1.5 text-2xs tracking-label text-text-secondary uppercase transition-colors duration-fast ease-out hover:bg-surface-3"
      >
        Dismiss
      </button>
    </div>
  );
}
