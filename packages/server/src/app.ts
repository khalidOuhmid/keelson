import type { IncomingMessage, ServerResponse } from "node:http";
import type { Operation } from "@keelson/core";
import { isAllowedHost, TOKEN_HEADER, tokensMatch } from "./security.ts";
import type { SseHub } from "./sse.ts";
import type { StaticHandler } from "./static.ts";
import type { DocumentStore } from "./store.ts";

export const MAX_BODY_BYTES = 1_048_576;

export type AppContext = {
  store: DocumentStore;
  hub: SseHub;
  token: string;
  port: () => number;
  serveStatic: StaticHandler;
};

type Json = Record<string, unknown>;

function send(response: ServerResponse, status: number, body: Json): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function fail(response: ServerResponse, status: number, code: string, message: string): void {
  send(response, status, { code, message });
}

async function readBody(request: IncomingMessage): Promise<string | "too-large"> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      request.pause();
      return "too-large";
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function decodeFile(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function createRequestHandler(context: AppContext) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${context.port()}`);

    if (!isAllowedHost(request.headers.host, context.port())) {
      fail(response, 403, "FORBIDDEN_HOST", "en-tête Host refusé par le serveur local");
      return;
    }

    const pathname = url.pathname;
    const isApi = pathname === "/api" || pathname.startsWith("/api/");

    if (isApi) {
      const presented =
        pathname === "/api/events"
          ? (url.searchParams.get("token") ?? undefined)
          : (request.headers[TOKEN_HEADER] as string | undefined);

      if (!tokensMatch(context.token, presented)) {
        fail(response, 403, "FORBIDDEN_TOKEN", "token de session absent ou invalide");
        return;
      }
    }

    if (pathname === "/api/workspace") {
      if (request.method !== "GET") {
        fail(response, 405, "METHOD_NOT_ALLOWED", `méthode ${request.method} refusée`);
        return;
      }
      send(response, 200, { files: context.store.workspaceFiles() as unknown as Json[] });
      return;
    }

    if (pathname === "/api/events") {
      if (request.method !== "GET") {
        fail(response, 405, "METHOD_NOT_ALLOWED", `méthode ${request.method} refusée`);
        return;
      }
      context.hub.attach(request, response);
      return;
    }

    const operations = /^\/api\/documents\/([^/]+)\/operations$/.exec(pathname);
    if (operations !== null) {
      if (request.method !== "POST") {
        fail(response, 405, "METHOD_NOT_ALLOWED", `méthode ${request.method} refusée`);
        return;
      }

      const file = decodeFile(operations[1] ?? "");
      if (file === null) {
        fail(response, 404, "NOT_FOUND", "nom de fichier illisible");
        return;
      }

      const raw = await readBody(request);
      if (raw === "too-large") {
        const payload = JSON.stringify({
          code: "PAYLOAD_TOO_LARGE",
          message: "corps de requête supérieur à 1 Mo",
        });
        response.writeHead(413, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
          connection: "close",
        });
        response.on("finish", () => request.destroy());
        response.end(payload);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        fail(response, 400, "INVALID_OPERATION", "corps de requête JSON illisible");
        return;
      }

      const envelope = parsed as { op?: unknown; opId?: unknown };
      if (typeof envelope.opId !== "string" || envelope.opId === "") {
        fail(response, 400, "INVALID_OPERATION", "opId absent ou vide");
        return;
      }
      if (typeof envelope.op !== "object" || envelope.op === null) {
        fail(response, 400, "INVALID_OPERATION", "op absent ou invalide");
        return;
      }

      const result = await context.store.applyOperation(
        file,
        envelope.op as Operation,
        envelope.opId,
      );
      send(response, result.status, result.body as unknown as Json);
      return;
    }

    const document = /^\/api\/documents\/([^/]+)$/.exec(pathname);
    if (document !== null) {
      if (request.method !== "GET") {
        fail(response, 405, "METHOD_NOT_ALLOWED", `méthode ${request.method} refusée`);
        return;
      }

      const file = decodeFile(document[1] ?? "");
      const loaded = file === null ? null : await context.store.load(file);
      if (loaded === null) {
        fail(response, 404, "NOT_FOUND", `fichier inconnu : ${file ?? ""}`);
        return;
      }
      send(response, 200, loaded as unknown as Json);
      return;
    }

    if (isApi) {
      fail(response, 404, "NOT_FOUND", `route inconnue : ${pathname}`);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      fail(response, 405, "METHOD_NOT_ALLOWED", `méthode ${request.method} refusée`);
      return;
    }

    if (!context.serveStatic(pathname, response)) {
      fail(response, 404, "NOT_FOUND", "aucun bundle d'interface n'est servi par ce serveur");
    }
  };
}
