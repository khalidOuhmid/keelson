import { randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/** A holder that lives longer than this is presumed gone, whatever its PID says: the PID may have
 *  been reused, or the lock may come from another machine sharing the directory. */
export const LOCK_STALE_MS = 30_000;
export const LOCK_TIMEOUT_MS = 10_000;
const RETRY_MS = 15;

type Holder = { pid: number; host: string; token: string };

export type LockOptions = { timeoutMs?: number };

/** The lock of the file a write will really replace: a link and its target share one. `null` when
 *  that file lies outside the root, where nothing may be written, not even a lock. */
export async function lockPathFor(root: string, path: string): Promise<string | null> {
  const realRoot = await realpath(root);
  const lexical = resolve(root, path);
  const target = await realpath(lexical).catch(async () => {
    const directory = dirname(lexical);
    const real = await realpath(directory).catch(() =>
      join(realRoot, relative(resolve(root), directory)),
    );
    return join(real, basename(lexical));
  });
  if (!target.startsWith(`${realRoot}${sep}`)) {
    return null;
  }
  return join(dirname(target), `.${basename(target)}.keelson-lock`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseHolder(text: string): Holder | null {
  try {
    const value = JSON.parse(text) as Partial<Holder>;
    return typeof value.pid === "number" &&
      typeof value.host === "string" &&
      typeof value.token === "string"
      ? { pid: value.pid, host: value.host, token: value.token }
      : null;
  } catch {
    return null;
  }
}

async function isStale(lock: string): Promise<string | null> {
  try {
    const [text, info] = await Promise.all([readFile(lock, "utf8"), stat(lock)]);
    if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
      return text;
    }
    const holder = parseHolder(text);
    return holder !== null && holder.host === hostname() && !alive(holder.pid) ? text : null;
  } catch {
    return null;
  }
}

/** Moved aside before being removed: if another process recovered it first and a live holder now
 *  owns the name, the lock moved aside is not the one judged stale, and is put back. */
async function recover(lock: string, judged: string): Promise<void> {
  const aside = `${lock}.${randomBytes(6).toString("hex")}`;
  try {
    await rename(lock, aside);
  } catch {
    return;
  }
  const moved = await readFile(aside, "utf8").catch(() => null);
  if (moved !== judged) {
    await link(aside, lock).catch(() => undefined);
  }
  await unlink(aside).catch(() => undefined);
}

async function acquire(lock: string, timeoutMs: number): Promise<string> {
  const token = randomBytes(12).toString("hex");
  const content = JSON.stringify({ pid: process.pid, host: hostname(), token, at: Date.now() });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(lock, "wx", 0o644);
      try {
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    const stale = await isStale(lock);
    if (stale !== null) {
      await recover(lock, stale);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${lock} is locked by another Keelson process`);
    }
    await new Promise((settle) => setTimeout(settle, RETRY_MS));
  }
}

async function release(lock: string, token: string): Promise<void> {
  const holder = parseHolder(await readFile(lock, "utf8").catch(() => ""));
  if (holder?.token === token) {
    await unlink(lock).catch(() => undefined);
  }
}

/** An advisory lock shared by every Keelson process — `keelson start` and `keelson apply` — around
 *  the re-read, the check and the rename of one file: a write by one can no longer land between
 *  the re-read and the rename of the other. */
export async function withFileLock<T>(
  root: string,
  path: string,
  work: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const lock = await lockPathFor(root, path);
  if (lock === null) {
    return work();
  }
  try {
    await mkdir(dirname(lock), { recursive: true });
  } catch {
    return work();
  }
  const token = await acquire(lock, options.timeoutMs ?? LOCK_TIMEOUT_MS);
  try {
    return await work();
  } finally {
    await release(lock, token);
  }
}
