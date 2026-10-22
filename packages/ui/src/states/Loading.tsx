export function Loading() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-0">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        Loading the pipeline…
      </p>
    </div>
  );
}
