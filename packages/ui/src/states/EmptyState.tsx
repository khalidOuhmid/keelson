export type EmptyStateProps = {
  heading: string;
  tone?: "neutral" | "alert";
  children: React.ReactNode;
};

export function EmptyState({ heading, tone = "neutral", children }: EmptyStateProps) {
  /** `border-default`, not `border-subtle`: this frame closes a shape, and `DESIGN.md` reserves
   *  `border-subtle` for structural rules. Found by the guard added in milestone L2b, which caught
   *  it because the variable pulls the class out of its `className` — the frame measures 3.81:1
   *  against `surface-1`, where `border-subtle` was at 1.26:1. */
  const border = tone === "alert" ? "border-warning-muted" : "border-border-default";

  return (
    <div className="flex h-full items-center justify-center bg-surface-0 p-6">
      <div
        {...(tone === "alert" ? { role: "alert" } : {})}
        className={`flex max-w-prose flex-col gap-2 rounded-lg border ${border} bg-surface-1 p-4`}
      >
        <h2 className="text-lg font-semibold text-text-primary">{heading}</h2>
        {children}
      </div>
    </div>
  );
}
