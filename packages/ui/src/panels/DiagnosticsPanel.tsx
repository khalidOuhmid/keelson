import type { Diagnostic, Severity, SourceRange } from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { ErrorIcon, InfoIcon, WarningIcon } from "../icons.tsx";

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const GLYPH: Record<Severity, React.ComponentType> = {
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
};

const TONE: Record<Severity, string> = {
  error: "border-danger-muted text-danger",
  warning: "border-warning-muted text-warning",
  info: "border-info-muted text-info",
};

export type DiagnosticsPanelProps = {
  diagnostics: readonly Diagnostic[];
  onSelectRange: (file: string, range: SourceRange | null) => void;
  /** Le fichier principal : les lignes qui viennent d'ailleurs le nomment, les autres non. */
  main: string;
  /** La bande de pipeline partiel énonce déjà les informations : les redire ici ferait annoncer
   *  deux fois le même fait. Filtré sur la sévérité, pas sur un code. */
  omitInfo?: boolean;
};

export function DiagnosticsPanel({
  diagnostics,
  onSelectRange,
  main,
  omitInfo = false,
}: DiagnosticsPanelProps) {
  const shown = omitInfo
    ? diagnostics.filter((diagnostic) => diagnostic.severity !== "info")
    : diagnostics;
  const sorted = [...shown].sort((left, right) => ORDER[left.severity] - ORDER[right.severity]);

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
              <Row diagnostic={diagnostic} onSelectRange={onSelectRange} main={main} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Body({ diagnostic, main }: { diagnostic: Diagnostic; main: string }) {
  return (
    <>
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          data-testid="severity-glyph"
          aria-hidden="true"
          className={`flex size-4 items-center justify-center rounded-sm border font-mono text-2xs ${TONE[diagnostic.severity]}`}
        >
          {(() => {
            const Icon = GLYPH[diagnostic.severity];
            return <Icon />;
          })()}
        </span>
        <span className="text-2xs tracking-label text-text-muted uppercase">
          {diagnostic.severity}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span data-testid="diagnostic-code" className="font-mono text-xs text-text-secondary">
            {diagnostic.code}
          </span>
          {/* Le fichier n'est nommé que quand ce n'est pas celui que l'utilisateur a sous les yeux :
              le répéter sur chaque ligne du fichier principal ne dirait rien. */}
          {diagnostic.file === main ? null : (
            <span data-testid="diagnostic-file" className="font-mono text-2xs text-text-muted">
              {diagnostic.file}
            </span>
          )}
        </span>
        <span className="text-sm text-text-primary">{renderMessage(diagnostic)}</span>
      </span>
    </>
  );
}

function Row({
  diagnostic,
  onSelectRange,
  main,
}: {
  diagnostic: Diagnostic;
  onSelectRange: (file: string, range: SourceRange | null) => void;
  main: string;
}) {
  const shared = "flex w-full items-start gap-2 px-3 py-2 text-left";

  if (diagnostic.range === null) {
    return (
      <div className={shared}>
        <Body diagnostic={diagnostic} main={main} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectRange(diagnostic.file, diagnostic.range)}
      className={`${shared} cursor-pointer transition-colors duration-fast ease-out hover:bg-surface-2`}
    >
      <Body diagnostic={diagnostic} main={main} />
    </button>
  );
}
