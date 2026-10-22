import type { Diagnostic, Severity, SourceRange } from "@keelson/core";

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const GLYPH: Record<Severity, string> = { error: "✕", warning: "!", info: "i" };

const TONE: Record<Severity, string> = {
  error: "border-danger-muted text-danger",
  warning: "border-warning-muted text-warning",
  info: "border-info-muted text-info",
};

export type DiagnosticsPanelProps = {
  diagnostics: readonly Diagnostic[];
  onSelectRange: (range: SourceRange | null) => void;
};

export function DiagnosticsPanel({ diagnostics, onSelectRange }: DiagnosticsPanelProps) {
  const sorted = [...diagnostics].sort(
    (left, right) => ORDER[left.severity] - ORDER[right.severity],
  );

  return (
    <section
      aria-label="Diagnostics"
      className="flex h-full flex-col border-t border-border-subtle bg-surface-1"
    >
      <header className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-1.5">
        <h2 className="text-2xs font-semibold tracking-label text-text-muted uppercase">
          Diagnostics
        </h2>
        <span className="font-mono text-2xs text-text-muted tabular-nums">{sorted.length}</span>
      </header>

      {sorted.length === 0 ? (
        <p className="px-3 py-2 text-sm text-text-muted">No diagnostics.</p>
      ) : (
        <ul className="flex flex-col overflow-y-auto">
          {sorted.map((diagnostic, index) => (
            <li
              key={`${diagnostic.code}-${diagnostic.range?.start ?? index}`}
              className="border-b border-border-subtle last:border-b-0"
            >
              <Row diagnostic={diagnostic} onSelectRange={onSelectRange} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Body({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <>
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          data-testid="severity-glyph"
          aria-hidden="true"
          className={`flex size-4 items-center justify-center rounded-sm border font-mono text-2xs ${TONE[diagnostic.severity]}`}
        >
          {GLYPH[diagnostic.severity]}
        </span>
        <span className="text-2xs tracking-label text-text-muted uppercase">
          {diagnostic.severity}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span data-testid="diagnostic-code" className="font-mono text-xs text-text-secondary">
          {diagnostic.code}
        </span>
        <span className="text-sm text-text-primary">{diagnostic.message}</span>
      </span>
    </>
  );
}

function Row({
  diagnostic,
  onSelectRange,
}: {
  diagnostic: Diagnostic;
  onSelectRange: (range: SourceRange | null) => void;
}) {
  const shared = "flex w-full items-start gap-2 px-3 py-2 text-left";

  if (diagnostic.range === null) {
    return (
      <div className={shared}>
        <Body diagnostic={diagnostic} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectRange(diagnostic.range)}
      className={`${shared} cursor-pointer transition-colors duration-fast ease-out hover:bg-surface-2`}
    >
      <Body diagnostic={diagnostic} />
    </button>
  );
}
