import { JOB_REFERENCED, renderMessage } from "@keelson/core/messages";
import type { ApiFailure } from "../api/client.ts";
import { referencedBy } from "./drafts.ts";

export type ErrorBannerProps = {
  error: ApiFailure | null;
  onDismiss: () => void;
};

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  if (error === null) {
    return null;
  }

  const referents = error.code === JOB_REFERENCED ? referencedBy(error) : [];

  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-danger-muted bg-danger-muted/20 px-3 py-1.5"
    >
      <span className="shrink-0 rounded-sm border border-danger px-1 font-mono text-2xs text-danger">
        {error.code}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-text-primary">{renderMessage(error)}</p>
        {referents.length === 0 ? null : (
          <ul className="flex flex-wrap gap-1.5">
            {referents.map((job) => (
              <li
                key={job}
                className="rounded-sm border border-border-default px-1 font-mono text-xs text-text-secondary"
              >
                {job}
              </li>
            ))}
          </ul>
        )}
      </div>
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
