export const FIELD =
  "w-full rounded-sm border border-border-default bg-surface-inset px-1.5 py-1 font-mono text-xs text-text-primary transition-colors duration-fast ease-out focus-visible:border-accent disabled:cursor-not-allowed disabled:text-text-muted";

export const BUTTON =
  "min-h-6 min-w-6 cursor-pointer rounded-sm border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors duration-fast ease-out hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent";

export const DANGER_BUTTON =
  "min-h-6 min-w-6 cursor-pointer rounded-sm border border-danger-muted px-2 py-1 text-xs text-danger transition-colors duration-fast ease-out hover:bg-danger-muted/30 disabled:cursor-not-allowed disabled:border-border-default disabled:text-text-muted disabled:hover:bg-transparent";

export const LABEL = "text-2xs font-semibold tracking-label text-text-muted uppercase";

export const GROUP = "flex flex-col gap-1.5";

/** Section heading. Distinct from `LABEL`, which labels a field: a section and a field cannot speak
 *  with the same voice, or there is no hierarchy left at all. */
export const SECTION_HEADING = "text-sm font-semibold text-text-secondary";
