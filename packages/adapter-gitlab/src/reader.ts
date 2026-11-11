import { type Dirent, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { readRegularFile } from "./files.ts";
import type { IncludeReader } from "./includes.ts";

const YAML_EXTENSIONS = [".yml", ".yaml"] as const;

/** Directories never walked for wildcard candidates. `.git` and `node_modules` contain thousands
 *  of files no `include` can target, and walking them would make the cost of the first wildcard
 *  proportional to the size of the repository. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

const MAX_WALK_ENTRIES = 50_000;

function textOf(path: string): string | null {
  const read = readRegularFile(path);
  return read.ok ? read.text : null;
}

function walk(root: string): string[] {
  const found: string[] = [];
  const queue: string[] = [""];

  while (queue.length > 0 && found.length < MAX_WALK_ENTRIES) {
    const relative = queue.shift();
    if (relative === undefined) {
      break;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push(path);
        }
        continue;
      }
      if (YAML_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        found.push(path);
      }
    }
  }

  return found;
}

/** The include reader on the file system, shared by the CLI and the server. A single
 *  implementation: it is the one that holds the root boundary, and two copies of that boundary
 *  would be two places to lose it.
 *
 *  `candidates()` is memoised and only computed on the first wildcard: a repository without a
 *  wildcard `include` never pays for the walk. */
/** The real path of `path` if it stays under `root`, otherwise `null`. */
function boundary(root: string): (path: string) => string | null {
  const absoluteRoot = resolve(root);
  const prefix = absoluteRoot.endsWith(sep) ? absoluteRoot : absoluteRoot + sep;
  /** The resolved root: the root itself may be reached through a link — a test folder under
   *  `/tmp` is on macOS — and comparing a real path with an unresolved prefix would then refuse
   *  everything. */
  let realRoot = absoluteRoot;
  try {
    realRoot = realpathSync(absoluteRoot);
  } catch {}
  const realPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;

  return (path) => {
    const absolute = resolve(absoluteRoot, path);
    // First check, lexical, after the one in `normaliseIncludePath`.
    if (!absolute.startsWith(prefix)) {
      return null;
    }

    // Second check, **on the real path**. Lexical checks do not see symbolic links:
    // `ci/fuite.yml → /etc/passwd` got through, and the target file's content ended up in the
    // payload sent to the browser. Found by the independent review of 2026-10-23.
    try {
      const real = realpathSync(absolute);
      return real.startsWith(realPrefix) ? real : null;
    } catch {
      return null;
    }
  };
}

/** Reads a non-YAML file of the repository, such as `.devsecops/layout.json`, behind the same
 *  boundary: a `JSON.parse` error message quotes the text read, so a link to an outside file
 *  would leak it through a diagnostic. */
export function readInsideRoot(root: string, path: string): string | null {
  const real = boundary(root)(path);
  if (real === null) {
    return null;
  }
  try {
    return textOf(real);
  } catch {
    return null;
  }
}

export function createFileReader(root: string): IncludeReader {
  const absoluteRoot = resolve(root);
  const realInside = boundary(root);
  let listed: string[] | null = null;

  return {
    read(path) {
      const real = realInside(path);
      if (real === null || !YAML_EXTENSIONS.some((extension) => real.endsWith(extension))) {
        return null;
      }

      // Regular files only: reading a FIFO blocks forever, and would freeze the server.
      try {
        return textOf(real);
      } catch {
        return null;
      }
    },
    candidates() {
      listed ??= walk(absoluteRoot);
      return listed;
    },
  };
}
