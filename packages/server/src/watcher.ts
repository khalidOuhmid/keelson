import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hashText } from "@keelson/core";
import type { DocumentStore } from "./store.ts";

export const DEBOUNCE_MS = 40;

export type DocumentEvent =
  | { kind: "document.changed"; file: string; hash: string }
  | { kind: "document.removed"; file: string };

export type Watcher = {
  close(): void;
};

/** Un fichier suivi : son chemin relatif à la racine, et le document principal qu'il faut relire
 *  quand il change. Pour le fichier principal lui-même, `file === main`. */
type Tracked = {
  file: string;
  main: string;
};

export function watchDocuments(
  root: string,
  store: DocumentStore,
  emit: (event: DocumentEvent) => void,
): Watcher {
  const watchers = new Map<string, FSWatcher>();
  const timers = new Map<string, NodeJS.Timeout>();
  const tracked = new Map<string, Tracked>();
  let closed = false;

  const inspectMain = async (file: string): Promise<void> => {
    const absolute = resolve(root, file);
    let text: string;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      if (store.currentHash(file) !== undefined) {
        store.forget(file);
        emit({ kind: "document.removed", file });
      }
      return;
    }

    if (hashText(text) === store.currentHash(file)) {
      return;
    }

    const loaded = await store.load(file);
    if (loaded !== null && !closed) {
      emit({ kind: "document.changed", file, hash: loaded.hash });
    }
  };

  /** Un fichier inclus n'a pas de hash dans le store, et Keelson ne l'écrit **jamais** : il n'y a
   *  donc aucune écriture propre à taire, et toute modification doit faire relire le document
   *  principal. Le garde de hash d'`inspectMain` protège contre les écritures du serveur lui-même
   *  et ne s'applique pas ici. */
  const reloadMain = async (main: string): Promise<void> => {
    const loaded = await store.load(main);
    if (loaded !== null && !closed) {
      emit({ kind: "document.changed", file: main, hash: loaded.hash });
    }
  };

  const schedule = (absolute: string, entry: Tracked): void => {
    const existing = timers.get(absolute);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    timers.set(
      absolute,
      setTimeout(() => {
        timers.delete(absolute);
        if (closed) {
          return;
        }
        void (entry.file === entry.main ? inspectMain(entry.main) : reloadMain(entry.main));
      }, DEBOUNCE_MS),
    );
  };

  /** Le dossier est surveillé, pas le fichier : un éditeur remplace souvent le fichier par un
   *  `rename`, et surveiller le fichier seul manquerait l'événement. */
  const watchDirectory = (directory: string): void => {
    if (watchers.has(directory)) {
      return;
    }
    try {
      const watcher = watch(directory, (_event, filename) => {
        if (filename === null || closed) {
          return;
        }
        const absolute = resolve(directory, filename.toString());
        const entry = tracked.get(absolute);
        if (entry !== undefined) {
          schedule(absolute, entry);
        }
      });
      watchers.set(directory, watcher);
    } catch {}
  };

  /** Recalculé à chaque chargement : l'ensemble des fichiers inclus change dès que le fichier
   *  principal change sa clé `include`. Les surveillances posées ne sont pas retirées — un dossier
   *  devenu inutile ne coûte qu'un descripteur, alors que le retirer ferait rater le retour d'un
   *  include qu'on vient tout juste d'enlever. */
  const sync = (): void => {
    if (closed) {
      return;
    }

    for (const entry of store.workspaceFiles()) {
      const main = entry.path;
      for (const file of [main, ...store.includedFiles(main)]) {
        const absolute = resolve(root, file);
        tracked.set(absolute, { file, main });
        watchDirectory(dirname(absolute));
      }
    }
  };

  sync();
  const unsubscribe = store.onLoaded(sync);

  return {
    close() {
      closed = true;
      unsubscribe();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
      tracked.clear();
    },
  };
}
