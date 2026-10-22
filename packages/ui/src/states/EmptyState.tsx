export type EmptyStateProps = {
  heading: string;
  tone?: "neutral" | "alert";
  children: React.ReactNode;
};

export function EmptyState({ heading, tone = "neutral", children }: EmptyStateProps) {
  const border = tone === "alert" ? "border-warning-muted" : "border-border-subtle";

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
