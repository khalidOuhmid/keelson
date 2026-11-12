import { useEffect, useRef } from "react";
import { BUTTON, SECTION_HEADING } from "../editing/controls.ts";
import { OpaqueBlockView } from "./OpaqueBlockView.tsx";

export type IncludedFileViewProps = {
  file: string;
  text: string;
  onClose: () => void;
};

/** An included file as Keelson read it: the text is already in the payload, so reading it needs
 *  no request, and nothing on this surface can write it. */
export function IncludedFileView({ file, text, onClose }: IncludedFileViewProps) {
  const close = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    close.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className={SECTION_HEADING}>Included file</h2>
          <p className="font-mono text-xs break-all text-text-primary">{file}</p>
        </div>
        <button ref={close} type="button" onClick={onClose} className={`shrink-0 ${BUTTON}`}>
          Close file
        </button>
      </header>
      <p className="text-xs text-text-secondary">
        Read-only. Keelson never writes included files: change this one in your own editor.
      </p>
      <OpaqueBlockView blockKey={`file-${file}`} source={text} />
    </div>
  );
}
