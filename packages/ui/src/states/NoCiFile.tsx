import { EmptyState } from "./EmptyState.tsx";

export type NoCiFileProps = {
  root: string;
};

export function NoCiFile({ root }: NoCiFileProps) {
  return (
    <EmptyState heading="No CI file detected">
      <p className="text-sm text-text-secondary">
        Keelson looked for <code className="font-mono text-text-primary">.gitlab-ci.yml</code> and{" "}
        <code className="font-mono text-text-primary">.github/workflows</code> in{" "}
        <code className="font-mono break-all text-text-primary">{root}</code> and found none.
      </p>
      <p className="text-sm text-text-muted">
        Create one in the folder you started Keelson from, then restart Keelson.
      </p>
    </EmptyState>
  );
}
