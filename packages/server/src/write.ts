import { randomBytes } from "node:crypto";
import { chmod, open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
