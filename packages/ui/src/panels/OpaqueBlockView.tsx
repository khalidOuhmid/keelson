import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

export type OpaqueBlockViewProps = {
  blockKey: string;
  source: string;
};

export function OpaqueBlockView({ blockKey, source }: OpaqueBlockViewProps) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) {
      return;
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [yaml(), EditorState.readOnly.of(true), EditorView.editable.of(false)],
      }),
    });

    return () => view.destroy();
  }, [source]);

  return (
    <div
      ref={host}
      data-testid={`opaque-editor-${blockKey}`}
      className="overflow-x-auto rounded-sm border border-border-subtle bg-surface-inset font-mono text-xs"
    />
  );
}
