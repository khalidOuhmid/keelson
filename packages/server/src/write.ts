import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

async function modeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch {
    return undefined;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    return;
  } finally {
    await handle?.close();
  }
}

export async function writeAtomic(path: string, text: string): Promise<void> {
  const directory = dirname(path);
  const temporary = join(directory, `.${basename(path)}.keelson-${randomBytes(6).toString("hex")}`);
  const mode = await modeOf(path);

  try {
    const handle = await open(temporary, "wx", mode ?? 0o644);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (mode !== undefined) {
      await chmod(temporary, mode);
    }

    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  await syncDirectory(directory);
}

/** For the `.devsecops` files, which Keelson creates itself: the directory may be missing, and a
 *  directory linked outside the repository must not become a write outside the root. Returns
 *  `false` without writing anything if the directory or the file escapes the root. */
export async function writeInsideRoot(root: string, path: string, text: string): Promise<boolean> {
  const directory = resolve(root, dirname(path));
  try {
    await mkdir(directory, { recursive: true });
  } catch {
    return false;
  }

  const realRoot = await realpath(root);
  const real = await realpath(directory);
  if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
    return false;
  }

  // An internal link stays a link: we write its target, after bounding it like the directory.
  const target = await realpath(join(real, basename(path))).catch(() => join(real, basename(path)));
  if (!target.startsWith(`${realRoot}${sep}`)) {
    return false;
  }
  await writeAtomic(target, text);
  return true;
}
