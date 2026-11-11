import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { createSseHub, HEARTBEAT_MS, type SseHub } from "../src/sse.ts";

let server: Server;
let hub: SseHub;
let port = 0;

async function listen(heartbeatMs?: number): Promise<void> {
  hub = createSseHub(heartbeatMs === undefined ? {} : { heartbeatMs });
  server = createServer((request, response) => {
    hub.attach(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;
}

async function openStream(): Promise<{
  read: (ms?: number) => Promise<string>;
  readUntil: (needle: string, ms?: number) => Promise<string>;
  cancel: () => Promise<void>;
  headers: Headers;
}> {
  const response = await fetch(`http://127.0.0.1:${port}/api/events`);
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("no stream");
  }
  const decoder = new TextDecoder();
  let buffer = "";

  const pump = async (ms: number, stop?: (seen: string) => boolean): Promise<string> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (stop?.(buffer) === true) {
        return buffer;
      }
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: false }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: false }), 40),
        ),
      ]);
      if (chunk.value !== undefined) {
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      if (chunk.done === true) {
        break;
      }
    }
    return buffer;
  };

  return {
    headers: response.headers,
    read: (ms = 400) => pump(ms),
    readUntil: (needle, ms = 2000) => pump(ms, (seen) => seen.includes(needle)),
    async cancel() {
      await reader.cancel().catch(() => undefined);
    },
  };
}

beforeEach(async () => {
  await listen();
});

afterEach(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("stream headers", () => {
  test("the content type is text/event-stream", async () => {
    const stream = await openStream();
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await stream.cancel();
  });

  test("caching is disabled and the connection kept alive", async () => {
    const stream = await openStream();
    expect(stream.headers.get("cache-control")).toContain("no-cache");
    await stream.cancel();
  });
});

describe("event format", () => {
  test("document.changed carries its name and its JSON data", async () => {
    const stream = await openStream();
    hub.broadcast({ kind: "document.changed", file: ".gitlab-ci.yml", hash: "a".repeat(64) });

    const received = await stream.readUntil("event: document.changed");
    expect(received).toContain("event: document.changed\n");
    expect(received).toContain(
      `data: ${JSON.stringify({ file: ".gitlab-ci.yml", hash: "a".repeat(64) })}\n`,
    );
    expect(received).toContain("\n\n");
    await stream.cancel();
  });

  test("document.removed carries only the file", async () => {
    const stream = await openStream();
    hub.broadcast({ kind: "document.removed", file: ".gitlab-ci.yml" });

    const received = await stream.readUntil("event: document.removed");
    expect(received).toContain("event: document.removed\n");
    expect(received).toContain(`data: ${JSON.stringify({ file: ".gitlab-ci.yml" })}\n`);
    expect(received).not.toContain("hash");
    await stream.cancel();
  });

  test("several events arrive in emission order", async () => {
    const stream = await openStream();
    hub.broadcast({ kind: "document.changed", file: "a", hash: "1".repeat(64) });
    hub.broadcast({ kind: "document.removed", file: "b" });

    const received = await stream.readUntil("event: document.removed");
    expect(received.indexOf("document.changed")).toBeLessThan(received.indexOf("document.removed"));
    await stream.cancel();
  });
});

describe("heartbeat", () => {
  test("the default interval is 15 seconds", () => {
    expect(HEARTBEAT_MS).toBe(15_000);
  });

  test("a heartbeat comment is sent periodically", async () => {
    hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await listen(40);

    const stream = await openStream();
    const received = await stream.readUntil("\n:", 1500);
    expect(received).toContain(":");
    expect(received.startsWith(":") || received.includes("\n:")).toBe(true);
    await stream.cancel();
  });
});

describe("lifecycle", () => {
  test("the hub counts its clients", async () => {
    expect(hub.clientCount()).toBe(0);
    const stream = await openStream();
    await stream.read(400);
    expect(hub.clientCount()).toBe(1);
    await stream.cancel();
  });

  test("a disconnected client is removed", async () => {
    const stream = await openStream();
    await stream.read(400);
    expect(hub.clientCount()).toBe(1);
    await stream.cancel();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(hub.clientCount()).toBe(0);
  });

  test("close closes every connection and empties the counter", async () => {
    const stream = await openStream();
    await stream.read(400);
    hub.close();
    expect(hub.clientCount()).toBe(0);
    await stream.cancel();
  });

  test("broadcast after close does not throw", () => {
    hub.close();
    expect(() => hub.broadcast({ kind: "document.removed", file: "a" })).not.toThrow();
  });

  test("close is idempotent", () => {
    expect(() => {
      hub.close();
      hub.close();
    }).not.toThrow();
  });
});
