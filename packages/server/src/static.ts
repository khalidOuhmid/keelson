import { createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function contentType(path: string): string {
  return TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

function fileInside(root: string, requested: string): string | null {
  const candidate = resolve(root, `.${requested}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return null;
  }
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export type StaticHandler = (pathname: string, response: ServerResponse) => boolean;

export function createStaticHandler(uiDir: string | undefined): StaticHandler {
  if (uiDir === undefined || !existsSync(uiDir)) {
    return () => false;
  }

  const root = resolve(uiDir);
  const index = join(root, "index.html");

  return (pathname, response) => {
    const direct = fileInside(root, pathname);
    const target = direct ?? (existsSync(index) ? index : null);
    if (target === null) {
      return false;
    }

    response.writeHead(200, {
      "content-type": contentType(target),
      "cache-control": target === index ? "no-store" : "no-cache",
    });
    createReadStream(target).pipe(response);
    return true;
  };
}
