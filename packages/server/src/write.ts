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

/** Pour les fichiers de `.devsecops`, que Keelson crée lui-même : le dossier peut manquer, et un
 *  dossier lié hors du dépôt ne doit pas devenir une écriture hors de la racine. `rename` remplace
 *  un lien sur le fichier sans le suivre, donc seul le dossier est à contrôler. Rend `false` sans
 *  rien écrire si le dossier sort de la racine. */
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

  await writeAtomic(join(real, basename(path)), text);
  return true;
}
