import type { WorkspaceFile } from "./client.ts";

export type ServerEvent =
  | { kind: "document.changed"; file: string; hash: string }
  | { kind: "document.removed"; file: string }
  | { kind: "document.written"; file: string; hash: string; opId: string }
  | { kind: "coverage.changed"; file: string }
  | { kind: "toolchain.changed"; hash: string }
  | { kind: "workspace.changed"; files: WorkspaceFile[] };

type DocumentEventKind = Exclude<ServerEvent["kind"], "toolchain.changed" | "workspace.changed">;

export type EventSourceFactory = (url: string) => EventSource;

export type Subscription = {
  close(): void;
};

function isWorkspaceFile(entry: unknown): entry is WorkspaceFile {
  const shape = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
    string,
    unknown
  >;
  return (
    typeof shape.path === "string" && (shape.adapter === "gitlab" || shape.adapter === "github")
  );
}

export function subscribe(
  url: string,
  onEvent: (event: ServerEvent) => void,
  factory: EventSourceFactory = (target) => new EventSource(target),
): Subscription {
  const source = factory(url);

  const handle = (kind: DocumentEventKind) => (message: MessageEvent<string>) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }
    const shape = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >;
    if (typeof shape.file !== "string") {
      return;
    }
    if (kind === "document.changed") {
      if (typeof shape.hash === "string") {
        onEvent({ kind, file: shape.file, hash: shape.hash });
      }
      return;
    }
    if (kind === "document.written") {
      if (typeof shape.hash === "string" && typeof shape.opId === "string") {
        onEvent({ kind, file: shape.file, hash: shape.hash, opId: shape.opId });
      }
      return;
    }
    onEvent({ kind, file: shape.file });
  };

  source.addEventListener("toolchain.changed", ((message: MessageEvent<string>) => {
    try {
      const { hash } = JSON.parse(message.data) as { hash?: unknown };
      if (typeof hash === "string") {
        onEvent({ kind: "toolchain.changed", hash });
      }
    } catch {
      return;
    }
  }) as EventListener);
  source.addEventListener("workspace.changed", ((message: MessageEvent<string>) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }
    const files = (payload as { files?: unknown } | null)?.files;
    if (Array.isArray(files) && files.every(isWorkspaceFile)) {
      onEvent({ kind: "workspace.changed", files });
    }
  }) as EventListener);
  source.addEventListener("document.changed", handle("document.changed") as EventListener);
  source.addEventListener("document.written", handle("document.written") as EventListener);
  source.addEventListener("document.removed", handle("document.removed") as EventListener);
  source.addEventListener("coverage.changed", handle("coverage.changed") as EventListener);

  return {
    close() {
      source.close();
    },
  };
}
