export type ServerEvent =
  | { kind: "document.changed"; file: string; hash: string }
  | { kind: "document.removed"; file: string }
  | { kind: "coverage.changed"; file: string }
  | { kind: "toolchain.changed"; hash: string };

type DocumentEventKind = Exclude<ServerEvent["kind"], "toolchain.changed">;

export type EventSourceFactory = (url: string) => EventSource;

export type Subscription = {
  close(): void;
};

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
  source.addEventListener("document.changed", handle("document.changed") as EventListener);
  source.addEventListener("document.removed", handle("document.removed") as EventListener);
  source.addEventListener("coverage.changed", handle("coverage.changed") as EventListener);

  return {
    close() {
      source.close();
    },
  };
}
