import type { Logo, Tool } from "@keelson/catalog";
import { isOpenSource } from "@keelson/catalog/licenses";
import { LAYER_GENERIC_GLYPH, LogoGlyph } from "../../icons.tsx";
import { OpaqueBlockView } from "../../panels/OpaqueBlockView.tsx";
import { LayerTags } from "../coverage/LayerTag.tsx";

export type ToolCardProps = {
  tool: Tool;
  logo: Logo | null;
  onClose: () => void;
};

function Snippet({ label, source }: { label: string; source: string | null }) {
  if (source === null) {
    return <p className="text-sm text-text-muted">No {label} snippet.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-2xs font-semibold tracking-label text-text-muted uppercase">{label}</h3>
      <OpaqueBlockView blockKey={`${label} snippet`} source={source.trimEnd()} />
    </div>
  );
}

export function ToolCard({ tool, logo, onClose }: ToolCardProps) {
  return (
    <section aria-label="Tool detail" className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-text-primary">
          {logo === null ? LAYER_GENERIC_GLYPH : <LogoGlyph path={logo.path} />}
          <span className="truncate">{tool.name}</span>
        </h2>
        <button
          type="button"
          aria-label="Close tool detail"
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded-sm border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors duration-fast ease-out hover:bg-surface-3"
        >
          Close
        </button>
      </header>

      <p className="flex flex-wrap items-center gap-1.5">
        <LayerTags layers={tool.layers} />
      </p>

      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-text-muted">License</dt>
          <dd data-testid="tool-license" className="text-text-secondary">
            <span className="font-mono text-xs">{tool.license}</span> ·{" "}
            {isOpenSource(tool) ? "open source" : "not open source"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-muted">Kind</dt>
          <dd className="text-text-secondary">
            {tool.kind === "job" ? "Runs as a job" : "Runs as a service"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-muted">Verified</dt>
          <dd className="text-text-secondary">
            <a
              href={tool.verifiedAt}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {tool.lastVerified}
            </a>
          </dd>
        </div>
      </dl>

      <a
        href={tool.homepage}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-accent underline underline-offset-2"
      >
        Homepage
      </a>

      <Snippet label="GitLab CI" source={tool.snippets.gitlab} />
      <Snippet label="GitHub Actions" source={tool.snippets.github} />
    </section>
  );
}
