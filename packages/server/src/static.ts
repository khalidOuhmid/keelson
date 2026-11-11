import { closeSync, constants, createReadStream, existsSync, fstatSync, openSync } from "node:fs";
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

/** A descriptor on a regular file, or `null`: the type is checked on the open descriptor, which is
 *  then the one streamed, so the path cannot change in between. */
function openRegular(path: string): number | null {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    if (fstatSync(descriptor).isFile()) {
      return descriptor;
    }
  } catch {}
  closeSync(descriptor);
  return null;
}

function fileInside(root: string, requested: string): string | null {
  const candidate = resolve(root, `.${requested}`);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
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
    const directDescriptor = direct === null ? null : openRegular(direct);
    const target = directDescriptor === null ? index : (direct as string);
    const descriptor = directDescriptor ?? openRegular(index);
    if (descriptor === null) {
      return false;
    }

    response.writeHead(200, {
      "content-type": contentType(target),
      "cache-control": target === index ? "no-store" : "no-cache",
    });
    createReadStream("", { fd: descriptor }).pipe(response);
    return true;
  };
}
