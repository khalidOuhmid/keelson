import type { Diagnostic } from "@keelson/core";
import { blocksEditing } from "../state/store.ts";

export type InvalidDocumentProps = {
  diagnostics: readonly Diagnostic[];
};

export function InvalidDocument({ diagnostics }: InvalidDocumentProps) {
  // ADR 0001 : la sévérité décrit la gravité, jamais l'effet sur l'outil. Lister ce qui bloque
  // réellement l'édition, pas ce qui est marqué « error ».
  const blocking = diagnostics.filter(blocksEditing);

  return (
    <div className="flex h-full items-center justify-center bg-surface-0 p-6">
      <div
        role="alert"
        className="flex max-w-prose flex-col gap-3 rounded-lg border border-danger-muted bg-surface-1 p-4"
      >
        <h2 className="text-lg font-semibold text-text-primary">This file cannot be parsed</h2>
        <p className="text-sm text-text-secondary">
          Editing is disabled until the YAML parses. Your file is left untouched on disk.
        </p>
        <ul className="flex flex-col gap-2">
          {blocking.map((diagnostic, index) => (
            <li
              key={`${diagnostic.code}-${diagnostic.range?.start ?? index}`}
              className="flex flex-col gap-0.5 rounded-sm border border-border-subtle bg-surface-inset p-2"
            >
              <span className="font-mono text-xs text-danger">{diagnostic.code}</span>
              <span className="text-sm text-text-primary">{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
