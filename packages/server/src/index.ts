import { createServer as createHttpServer, type Server } from "node:http";
import { resolve } from "node:path";
import { INTERNAL_ERROR } from "@keelson/core/messages";
import { createRequestHandler } from "./app.ts";
import { createToken, LOOPBACK } from "./security.ts";
import { createSseHub } from "./sse.ts";
import { createStaticHandler } from "./static.ts";
import { DocumentStore } from "./store.ts";
import { ToolchainStore } from "./toolchain.ts";
import { watchDocuments } from "./watcher.ts";
import { detectWorkspace } from "./workspace.ts";

export const PACKAGE_NAME = "@keelson/server";

export type ServerOptions = {
  root: string;
  port?: number;
  token?: string;
  uiDir?: string;
};

export type KeelsonServer = {
  url: string;
  port: number;
  token: string;
  address(): string;
  close(): Promise<void>;
};

export { type Adapter, adapterFor } from "./adapters.ts";
export { MAX_BODY_BYTES } from "./app.ts";
export { createToken, isAllowedHost, LOOPBACK, TOKEN_HEADER, tokensMatch } from "./security.ts";
export { HEARTBEAT_MS } from "./sse.ts";
export { DocumentStore, OPID_HISTORY } from "./store.ts";
export { ToolchainStore } from "./toolchain.ts";
export type { DocumentEvent } from "./watcher.ts";
export { detectWorkspace, GITLAB_CI_FILE, type WorkspaceFile } from "./workspace.ts";
export { writeAtomic, writeInsideRoot } from "./write.ts";

export async function createServer(options: ServerOptions): Promise<KeelsonServer> {
  const root = resolve(options.root);
  const token = options.token ?? createToken();
  const store = new DocumentStore(root, detectWorkspace(root));
  const toolchain = new ToolchainStore(root, store);
  const hub = createSseHub();

  let port = 0;
  const http: Server = createHttpServer();

  const handler = createRequestHandler({
    store,
    toolchain,
    hub,
    token,
    port: () => port,
    serveStatic: createStaticHandler(options.uiDir),
  });

  http.on("request", (request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify({ code: INTERNAL_ERROR, params: {} }));
    });
  });

  await new Promise<void>((settle, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, LOOPBACK, () => {
      http.removeListener("error", reject);
      settle();
    });
  });

  const address = http.address();
  port = typeof address === "object" && address !== null ? address.port : 0;

  const watcher = watchDocuments(root, store, (event) => hub.broadcast(event));
  const unsubscribeWritten = store.onWritten((written) =>
    hub.broadcast({ kind: "document.written", ...written }),
  );

  return {
    url: `http://${LOOPBACK}:${port}/?token=${token}`,
    port,
    token,
    address: () => LOOPBACK,
    async close() {
      watcher.close();
      unsubscribeWritten();
      hub.close();
      await new Promise<void>((settle) => {
        http.close(() => settle());
      });
      http.closeAllConnections?.();
    },
  };
}
