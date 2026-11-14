import { describe, expect, test } from "bun:test";
import type { WorkspaceFile } from "../src/api/client.ts";
import { type ServerEvent, subscribe } from "../src/api/events.ts";

class FakeSource {
  readonly listeners = new Map<string, (message: MessageEvent<string>) => void>();
  closed = false;

  addEventListener(kind: string, listener: (message: MessageEvent<string>) => void): void {
    this.listeners.set(kind, listener);
  }

  close(): void {
    this.closed = true;
  }

  send(kind: string, data: string): void {
    this.listeners.get(kind)?.({ data } as MessageEvent<string>);
  }
}

function listen(): { source: FakeSource; events: ServerEvent[] } {
  const source = new FakeSource();
  const events: ServerEvent[] = [];
  subscribe(
    "/api/events",
    (event) => events.push(event),
    () => source as unknown as EventSource,
  );
  return { source, events };
}

describe("server events", () => {
  test("document.written carries the file, the hash and the opId of the write", () => {
    const { source, events } = listen();
    source.send("document.written", JSON.stringify({ file: "a.yml", hash: "h", opId: "op-1" }));
    expect(events).toEqual([{ kind: "document.written", file: "a.yml", hash: "h", opId: "op-1" }]);
  });

  test("a document.written without an opId is dropped", () => {
    const { source, events } = listen();
    source.send("document.written", JSON.stringify({ file: "a.yml", hash: "h" }));
    expect(events).toEqual([]);
  });

  test("workspace.changed carries the whole file list", () => {
    const { source, events } = listen();
    const files: WorkspaceFile[] = [
      { path: ".gitlab-ci.yml", adapter: "gitlab" },
      { path: ".github/workflows/ci.yml", adapter: "github" },
    ];
    source.send("workspace.changed", JSON.stringify({ files }));
    expect(events).toEqual([{ kind: "workspace.changed", files }]);
  });

  test("a workspace.changed whose list is malformed is dropped", () => {
    const { source, events } = listen();
    source.send(
      "workspace.changed",
      JSON.stringify({ files: [{ path: "x.yml", adapter: "jenkins" }] }),
    );
    source.send("workspace.changed", "{not json");
    expect(events).toEqual([]);
  });
});
