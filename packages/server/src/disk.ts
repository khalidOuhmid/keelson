import { lstatSync } from "node:fs";
import { join } from "node:path";
import { readInsideRoot } from "@keelson/adapter-gitlab";

/** What the UTF-8 decoder puts in place of invalid bytes: a file that decodes to it would be
 *  rewritten with it, so it counts as unreadable. */
const REPLACEMENT_CHARACTER = "�";

export type Disk = { kind: "absent" } | { kind: "unreadable" } | { kind: "text"; text: string };

/** A file that cannot be read is not a missing file: treating it as empty would overwrite it.
 *  Unreadable means: what escapes the root, what refuses reading, a directory, and anything that
 *  is not UTF-8, which a patch would rewrite with replacement characters. */
export function readDisk(root: string, path: string): Disk {
  const text = readInsideRoot(root, path);
  if (text !== null) {
    return text.includes(REPLACEMENT_CHARACTER) ? { kind: "unreadable" } : { kind: "text", text };
  }
  try {
    lstatSync(join(root, path));
    return { kind: "unreadable" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { kind: code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreadable" };
  }
}
