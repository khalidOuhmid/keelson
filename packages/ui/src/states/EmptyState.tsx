export type EmptyStateProps = {
  heading: string;
  tone?: "neutral" | "alert";
  children: React.ReactNode;
};

export function EmptyState({ heading, tone = "neutral", children }: EmptyStateProps) {
  /** `border-default` et non `border-subtle` : ce cadre ferme une forme, et `DESIGN.md` réserve
   *  `border-subtle` aux filets structurels. Trouvé par le garde ajouté au lot L2b, qui l'a vu
   *  parce que la variable sort la classe de son `className` — le cadre est mesuré à 3,81:1 contre
   *  `surface-1`, là où `border-subtle` était à 1,26:1. */
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
