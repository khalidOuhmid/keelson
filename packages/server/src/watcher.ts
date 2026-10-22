import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hashText } from "@keelson/core";
import type { DocumentStore } from "./store.ts";

export const DEBOUNCE_MS = 40;

export type DocumentEvent =
  | { kind: "document.changed"; file: string; hash: string }
  | { kind: "document.removed"; file: string };

export type Watcher = {
  close(): void;
};

export function watchDocuments(
  root: string,
  store: DocumentStore,
  emit: (event: DocumentEvent) => void,
): Watcher {
  const watchers: FSWatcher[] = [];
  const timers = new Map<string, NodeJS.Timeout>();
  let closed = false;

  const inspect = async (file: string): Promise<void> => {
    if (closed) {
      return;
    }

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

  const schedule = (file: string): void => {
    const existing = timers.get(file);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file);
        void inspect(file);
      }, DEBOUNCE_MS),
    );
  };

  const directories = new Map<string, string[]>();
  for (const entry of store.workspaceFiles()) {
    const directory = dirname(resolve(root, entry.path));
    directories.set(directory, [...(directories.get(directory) ?? []), entry.path]);
  }

  for (const [directory, files] of directories) {
    const names = new Map(files.map((file) => [join(root, file), file]));
    try {
      const watcher = watch(directory, (_event, filename) => {
        if (filename === null || closed) {
          return;
        }
        const file = names.get(resolve(directory, filename.toString()));
        if (file !== undefined) {
          schedule(file);
        }
      });
      watchers.push(watcher);
    } catch {}
  }

  return {
    close() {
      closed = true;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.length = 0;
    },
  };
}
