export type HistoryControlsProps = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

const BUTTON =
  "cursor-pointer rounded-sm border border-border-default px-2 py-0.5 text-xs text-text-secondary transition-colors duration-fast ease-out hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent";

export function HistoryControls({ canUndo, canRedo, onUndo, onRedo }: HistoryControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl/Cmd+Z)"
        className={BUTTON}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
        className={BUTTON}
      >
        Redo
      </button>
    </div>
  );
}
