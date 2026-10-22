import { EmptyState } from "./EmptyState.tsx";

export type DocumentRemovedProps = {
  file: string;
};

export function DocumentRemoved({ file }: DocumentRemovedProps) {
  return (
    <EmptyState heading="The file was deleted" tone="alert">
      <p className="text-sm text-text-secondary">
        <code className="font-mono break-all text-text-primary">{file}</code> no longer exists on
        disk.
      </p>
      <p className="text-sm text-text-muted">
        Keelson keeps watching the folder and will load the pipeline again as soon as the file
        reappears.
      </p>
    </EmptyState>
  );
}
