import { useEffect } from "react";

export type HistoryShortcuts = {
  enabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

function inTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null) {
    return false;
  }
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable === true) {
    return true;
  }
  // A read-only CodeMirror `.cm-content` is a `div` with `contenteditable="false"`:
  // `isContentEditable` is `false` there, so the guard above lets it through.
  return element.closest?.(".cm-editor") !== null && element.closest?.(".cm-editor") !== undefined;
}

export function useHistoryShortcuts({ enabled, onUndo, onRedo }: HistoryShortcuts): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handle = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (inTextEntry(event.target)) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        onRedo();
        return;
      }
      onUndo();
    };

    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled, onUndo, onRedo]);
}
