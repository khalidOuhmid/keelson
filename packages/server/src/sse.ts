import type { IncomingMessage, ServerResponse } from "node:http";
import type { DocumentEvent } from "./watcher.ts";

export const HEARTBEAT_MS = 15_000;

export type SseHub = {
  attach(request: IncomingMessage, response: ServerResponse): void;
  broadcast(event: DocumentEvent): void;
  clientCount(): number;
  close(): void;
};

type Options = {
  heartbeatMs?: number;
};

function payloadOf(event: DocumentEvent): string {
  const { kind: _kind, ...payload } = event;
  return JSON.stringify(payload);
}

export function createSseHub(options: Options = {}): SseHub {
  const clients = new Set<ServerResponse>();
  const interval = options.heartbeatMs ?? HEARTBEAT_MS;
  let closed = false;
  let heartbeat: NodeJS.Timeout | undefined;

  const startHeartbeat = (): void => {
    if (heartbeat !== undefined) {
      return;
    }
    heartbeat = setInterval(() => {
      for (const client of clients) {
        client.write(": keelson\n\n");
      }
    }, interval);
    heartbeat.unref?.();
  };

  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };

  return {
    attach(request, response) {
      if (closed) {
        response.writeHead(503).end();
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      response.write(": keelson\n\n");

      clients.add(response);
      startHeartbeat();

      const drop = (): void => {
        clients.delete(response);
        if (clients.size === 0) {
          stopHeartbeat();
        }
      };

      request.on("close", drop);
      request.on("error", drop);
      response.on("close", drop);
      response.on("error", drop);
    },

    broadcast(event) {
      if (closed) {
        return;
      }
      const frame = `event: ${event.kind}\ndata: ${payloadOf(event)}\n\n`;
      for (const client of clients) {
        client.write(frame);
      }
    },

    clientCount() {
      return clients.size;
    },

    close() {
      closed = true;
      stopHeartbeat();
      for (const client of clients) {
        client.end();
      }
      clients.clear();
    },
  };
}
