import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type KeelsonServer, type ServerOptions } from "../../src/index.ts";

export const SAMPLE = [
  "stages:",
  "  - build",
  "  - test",
  "  - deploy",
  "",
  ".base:",
  "  image: node:22",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - compile",
  "  script:",
  "    - make check",
  "",
].join("\n");

export type Harness = {
  server: KeelsonServer;
  root: string;
  file: string;
  api: (path: string, init?: RequestInit) => Promise<Response>;
  raw: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
};

export async function startHarness(
  options: { text?: string | null; uiDir?: string } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "keelson-http-"));
  if (options.text !== null) {
    writeFileSync(join(root, ".gitlab-ci.yml"), options.text ?? SAMPLE);
  }

  const serverOptions: ServerOptions = { root, port: 0 };
  const server = await createServer(
    options.uiDir === undefined ? serverOptions : { ...serverOptions, uiDir: options.uiDir },
  );

  const base = `http://127.0.0.1:${server.port}`;

  return {
    server,
    root,
    file: join(root, ".gitlab-ci.yml"),
    raw: (path, init) => fetch(`${base}${path}`, init),
    api: (path, init = {}) =>
      fetch(`${base}${path}`, {
        ...init,
        headers: {
          "x-keelson-token": server.token,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(init.headers ?? {}),
        },
      }),
    close: () => server.close(),
  };
}

export async function codeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { code?: unknown };
  return typeof body.code === "string" ? body.code : "";
}
