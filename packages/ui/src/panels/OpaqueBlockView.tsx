import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

/** CodeMirror came with its default theme: this block's colours came from the package rather than
 *  the palette, the only surface of the product in that situation. Every hue comes from a token. */
const KEELSON_HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--color-text-primary)" },
  { tag: tags.propertyName, color: "var(--color-accent)" },
  { tag: tags.string, color: "var(--color-text-secondary)" },
  { tag: tags.number, color: "var(--color-text-secondary)" },
  { tag: tags.bool, color: "var(--color-text-secondary)" },
  { tag: tags.comment, color: "var(--color-text-muted)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--color-text-muted)" },
]);

/** The container already carries the font, size and background: the theme only neutralises what
 *  CodeMirror imposes on top, and introduces no value of its own. */
const KEELSON_THEME = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--color-text-secondary)" },
  ".cm-content": { fontFamily: "inherit", fontSize: "inherit", padding: "var(--spacing)" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { display: "none" },
  "&.cm-focused": { outline: "none" },
});

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
        extensions: [
          yaml(),
          syntaxHighlighting(KEELSON_HIGHLIGHT),
          KEELSON_THEME,
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    });

    return () => view.destroy();
  }, [source]);

  return (
    <div
      ref={host}
      data-testid={`opaque-editor-${blockKey}`}
      className="rounded-sm border border-border-default bg-surface-inset font-mono text-xs"
    />
  );
}
