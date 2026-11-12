import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { WORKFLOWS_DIR } from "@keelson/adapter-github";
import { readInsideRoot } from "@keelson/adapter-gitlab";
import { hashText, TOOLCHAIN_FILE } from "@keelson/core";
import { LAYOUT_FILE } from "@keelson/toolchain";
import type { DocumentStore } from "./store.ts";
import { detectWorkspace, GITLAB_CI_FILE, type WorkspaceFile } from "./workspace.ts";

export const DEBOUNCE_MS = 40;

export type DocumentEvent =
  | { kind: "document.changed"; file: string; hash: string }
  | { kind: "document.removed"; file: string }
  /** `layout.json` changed, not the pipeline: the screen redraws coverage without touching the
   *  undo history or announcing a modified file. */
  | { kind: "coverage.changed"; file: string }
  | { kind: "toolchain.changed"; hash: string }
  /** A workflow or `.gitlab-ci.yml` appeared or disappeared: `files` is the whole new list, the
   *  same as `GET /api/workspace`. */
  | { kind: "workspace.changed"; files: WorkspaceFile[] };

export type Watcher = {
  close(): void;
};

/** A tracked file: its path relative to the root, and the main document to re-read when it
 *  changes. For the main file itself, `file === main`. */
type Tracked = {
  file: string;
  main: string;
  /** `.devsecops`, `layout.json` or `toolchain.yaml`: they decide coverage and the toolchain, not
   *  the pipeline. */
  companion: boolean;
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
  const toolchainHash = (): string => hashText(readInsideRoot(root, TOOLCHAIN_FILE) ?? "");
  let knownToolchain = toolchainHash();
  const workflowsDirectory = resolve(root, WORKFLOWS_DIR);
  const githubDirectory = dirname(workflowsDirectory);

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

    // The file exists but the reader refuses it, for example a link outside the root. `load` purges
    // it from the store: the screen must learn this, or it stays on a pipeline that no longer exists.
    const known = store.currentHash(file) !== undefined;
    const loaded = await store.load(file);
    if (closed) {
      return;
    }
    if (loaded !== null) {
      emit({ kind: "document.changed", file, hash: loaded.hash });
    } else if (known) {
      emit({ kind: "document.removed", file });
    }
  };

  /** An included file has no hash in the store, and Keelson **never** writes it: there is thus no
   *  own write to silence, and any change must re-read the main document. `inspectMain`'s hash guard
   *  protects against the server's own writes and does not apply here. */
  const reloadMain = async (main: string): Promise<void> => {
    const loaded = await store.load(main);
    if (loaded !== null && !closed) {
      emit({ kind: "document.changed", file: main, hash: loaded.hash });
    }
  };

  const reloadCoverage = async (entry: Tracked, absolute: string): Promise<void> => {
    // A deleted directory keeps its watcher, now dead: remove it so that loading sets a new one
    // if the directory exists again.
    if (entry.file === dirname(LAYOUT_FILE)) {
      watchers.get(absolute)?.close();
      watchers.delete(absolute);
    }
    // These files are repository-wide: every loaded document must learn about them.
    const mains = store
      .workspaceFiles()
      .map((file) => file.path)
      .filter((path) => path === entry.main || store.currentHash(path) !== undefined);
    for (const main of mains) {
      const known = store.currentHash(main);
      // An unreadable file must not deprive the next ones or the toolchain of their event.
      const loaded = await store.load(main).catch(() => {
        store.forget(main);
        return null;
      });
      if (closed) {
        return;
      }
      // Loading advances the store's hash: `inspectMain` would see nothing more, and this event
      // must also say what happened to the main file.
      if (loaded === null) {
        if (known !== undefined) {
          emit({ kind: "document.removed", file: main });
        }
      } else if (loaded.hash === known) {
        emit({ kind: "coverage.changed", file: main });
      } else {
        emit({ kind: "document.changed", file: main, hash: loaded.hash });
      }
    }

    const toolchain = toolchainHash();
    if (toolchain !== knownToolchain) {
      knownToolchain = toolchain;
      emit({ kind: "toolchain.changed", hash: toolchain });
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
        const inspected = entry.companion
          ? reloadCoverage(entry, absolute)
          : entry.file === entry.main
            ? inspectMain(entry.main)
            : reloadMain(entry.main);
        // A file the parser cannot read must not kill the server: under Node, an unhandled
        // rejection ends the process. The store forgets it: its old text is no longer the one
        // on disk, and an operation based on it would overwrite it.
        inspected.catch(() => store.forget(entry.main));
      }, DEBOUNCE_MS),
    );
  };

  /** The directory is watched, not the file: an editor often replaces the file with a `rename`,
   *  and watching the file alone would miss the event. */
  const watchDirectory = (directory: string): void => {
    if (watchers.has(directory)) {
      return;
    }
    try {
      const watcher = watch(directory, (_event, filename) => {
        if (filename === null || closed) {
          return;
        }
        const name = filename.toString();
        const absolute = resolve(directory, name);
        const entry = tracked.get(absolute);
        if (entry !== undefined) {
          schedule(absolute, entry);
        }
        if (
          directory === workflowsDirectory ||
          absolute === githubDirectory ||
          absolute === workflowsDirectory ||
          (directory === root && name === GITLAB_CI_FILE)
        ) {
          scheduleWorkspace(absolute === githubDirectory || absolute === workflowsDirectory);
        }
      });
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(directory);
      });
      watchers.set(directory, watcher);
    } catch {}
  };

  /** Recomputed on each load: the set of included files changes as soon as the main file changes
   *  its `include` key. Watches already set are not removed — a directory no longer needed costs
   *  only a descriptor, whereas removing it would miss the return of an include just removed. */
  const sync = (): void => {
    if (closed) {
      return;
    }

    for (const entry of store.workspaceFiles()) {
      const main = entry.path;
      // `.devsecops` is listed for itself too: while it does not exist, only the parent directory
      // can see it being created, and so set the watch on `layout.json`.
      const companions = [dirname(LAYOUT_FILE), LAYOUT_FILE, TOOLCHAIN_FILE];
      for (const file of [main, ...store.includedFiles(main), ...companions]) {
        const absolute = resolve(root, file);
        tracked.set(absolute, { file, main, companion: companions.includes(file) });
        watchDirectory(dirname(absolute));
      }
    }
  };

  const watchWorkspace = (): void => {
    for (const directory of [root, githubDirectory, workflowsDirectory]) {
      watchDirectory(directory);
    }
  };

  /** A deleted directory keeps its watcher, now dead: when `.github` or `.github/workflows` itself
   *  comes and goes, both are watched afresh, so a recreated directory is seen again. */
  const rescan = (directoriesMoved: boolean): void => {
    if (directoriesMoved) {
      for (const directory of [githubDirectory, workflowsDirectory]) {
        watchers.get(directory)?.close();
        watchers.delete(directory);
      }
    }
    watchWorkspace();
    const files = detectWorkspace(root);
    if (JSON.stringify(files) === JSON.stringify(store.workspaceFiles())) {
      return;
    }
    const kept = new Set(files.map((file) => file.path));
    const dropped = store.workspaceFiles().filter((file) => !kept.has(file.path));
    store.setFiles(files);
    for (const { path } of dropped) {
      if (store.currentHash(path) !== undefined) {
        store.forget(path);
        emit({ kind: "document.removed", file: path });
      }
    }
    sync();
    emit({ kind: "workspace.changed", files });
  };

  let workspaceTimer: NodeJS.Timeout | undefined;
  let workspaceMoved = false;
  function scheduleWorkspace(directoriesMoved: boolean): void {
    workspaceMoved ||= directoriesMoved;
    if (workspaceTimer !== undefined) {
      clearTimeout(workspaceTimer);
    }
    workspaceTimer = setTimeout(() => {
      workspaceTimer = undefined;
      const moved = workspaceMoved;
      workspaceMoved = false;
      if (!closed) {
        rescan(moved);
      }
    }, DEBOUNCE_MS);
  }

  sync();
  watchWorkspace();
  const unsubscribe = store.onLoaded(sync);

  return {
    close() {
      closed = true;
      unsubscribe();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      if (workspaceTimer !== undefined) {
        clearTimeout(workspaceTimer);
      }
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
      tracked.clear();
    },
  };
}
