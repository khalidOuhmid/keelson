import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

export type ReadResult = { ok: true; text: string } | { ok: false; reason: "notFile" | "missing" };

/** Opens once, checks the type on the open descriptor, and reads that same descriptor: the path
 *  cannot be swapped for a link or a FIFO between the check and the read. `O_NONBLOCK` keeps a
 *  FIFO from blocking the open. */
export function readRegularFile(path: string): ReadResult {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { ok: false, reason: code === "EISDIR" ? "notFile" : "missing" };
  }
  try {
    return fstatSync(descriptor).isFile()
      ? { ok: true, text: readFileSync(descriptor, "utf8") }
      : { ok: false, reason: "notFile" };
  } finally {
    closeSync(descriptor);
  }
}
