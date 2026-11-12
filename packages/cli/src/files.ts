import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { readDisk } from "@keelson/server";

export type Refusal = "absent" | "outside" | "notFile" | "unreadable";

export type Read = { ok: true; text: string } | { ok: false; reason: Refusal };

function escapesRoot(root: string, path: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(resolve(root, path));
    return real !== realRoot && !real.startsWith(`${realRoot}${sep}`);
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The read of `keelson start`, with the reason why a file that exists gives no text: a link out
 *  of the root, a directory, or a file that is not UTF-8 or refuses reading. */
export function readInside(root: string, path: string): Read {
  const disk = readDisk(root, path);
  if (disk.kind === "text") {
    return { ok: true, text: disk.text };
  }
  if (disk.kind === "absent") {
    return { ok: false, reason: "absent" };
  }
  if (escapesRoot(root, path)) {
    return { ok: false, reason: "outside" };
  }
  return { ok: false, reason: isDirectory(resolve(root, path)) ? "notFile" : "unreadable" };
}

export function refusalMessage(reason: Refusal, file: string): string {
  switch (reason) {
    case "absent":
      return `file not found: ${file}`;
    case "outside":
      return `${file} is outside the repository`;
    case "notFile":
      return `${file} is not a file`;
    case "unreadable":
      return `${file} cannot be read: it is not a UTF-8 file, or not readable`;
  }
}
