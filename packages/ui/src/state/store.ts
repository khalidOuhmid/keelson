import type { Coverage } from "@keelson/catalog";
import type { Diagnostic, Operation, Pipeline, SourceRange, SpliceOperation } from "@keelson/core";
import { INVALID_YAML } from "@keelson/core";
import type { LayerId } from "@keelson/taxonomy";
import { createStore as createZustandStore, type StoreApi } from "zustand/vanilla";
import type {
  ApiFailure,
  ApiResult,
  CatalogPayload,
  DocumentPayload,
  OperationPayload,
  WorkspaceFile,
} from "../api/client.ts";
import type { ServerEvent } from "../api/events.ts";

export type Draft = Operation extends infer T
  ? T extends { v: 1; baseHash: string }
    ? Omit<T, "v" | "baseHash">
    : never
  : never;

export type Notice =
  | { kind: "stale"; message: string }
  | { kind: "reloaded"; message: string }
  | { kind: "written"; message: string }
  | { kind: "opened"; message: string }
  | { kind: "removed"; message: string };

export type Status = "loading" | "ready" | "removed" | "empty";

/** Only a document the IR cannot model forbids editing: a validation error such as UNKNOWN_NEED is
 *  precisely what editing fixes. */
export function blocksEditing(diagnostic: Diagnostic): boolean {
  return diagnostic.code === INVALID_YAML;
}

type HistoryEntry = {
  redo: Draft;
  inverse: SpliceOperation;
};

export type StoreDependencies = {
  submit: (file: string, op: Operation, opId: string) => Promise<ApiResult<OperationPayload>>;
  document: (file: string) => Promise<ApiResult<DocumentPayload>>;
  catalog: () => Promise<ApiResult<CatalogPayload>>;
  newOpId: () => string;
};

export type View = "pipeline" | "toolchain" | "coverage" | "catalog";

export type KeelsonState = {
  file: string | null;
  text: string;
  /** The text of each included file, by path. `textOf` reads here or in `text`: a range from an
   *  included file sliced out of the main file's text would render bytes taken from elsewhere. */
  included: Record<string, string>;
  pipeline: Pipeline | null;
  coverage: Coverage | null;
  catalog: CatalogPayload | null;
  view: View;
  /** The layer emphasised on the overlay. */
  selectedLayer: LayerId | null;
  /** The layer filter applied when the catalogue opens, set by "See tools". */
  catalogLayer: LayerId | null;
  diagnostics: Diagnostic[];
  hash: string | null;
  status: Status;
  selectedJobId: string | null;
  error: ApiFailure | null;
  notice: Notice | null;
  pending: boolean;
  /** The repository's CI files, as listed by `/api/workspace`. */
  files: WorkspaceFile[];

  workspaceLoaded(files: WorkspaceFile[]): void;
  /** Opens another file of the repository: undo history belongs to a single file. */
  openFile(file: string): Promise<void>;
  /** The current file is read by an adapter that Keelson does not edit yet. */
  readOnly(): boolean;
  documentLoaded(file: string, payload: DocumentPayload): void;
  workspaceEmpty(): void;
  selectJob(id: string | null): void;
  setView(view: View): void;
  selectLayer(layer: LayerId | null): void;
  showTools(layer: LayerId): void;
  loadCatalog(): Promise<void>;
  selectByRange(file: string, range: SourceRange | null): void;
  textOf(file: string): string;
  canEdit(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** `true` if the write happened. */
  submit(draft: Draft): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  serverEvent(event: Exclude<ServerEvent, { kind: "toolchain.changed" }>): Promise<void>;
  dismissNotice(): void;
  /** Announces what was just written at the user's request. */
  announce(message: string): void;
  announceOpened(file: string, historyLost: boolean): void;
  dismissError(): void;
};

export type KeelsonStore = StoreApi<KeelsonState>;

const RELOADED: Notice = {
  kind: "reloaded",
  message: "The file changed on disk and was reloaded.",
};

export function createStore(dependencies: StoreDependencies): KeelsonStore {
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];

  return createZustandStore<KeelsonState>()((set, get) => {
    const clearHistory = (): void => {
      undoStack = [];
      redoStack = [];
    };

    const applyPayload = (payload: OperationPayload): void => {
      // The selection must drop if the job was just deleted — `reload` already does so. Otherwise
      // the id dangles, the panel would reopen on a job recreated under the same name, and the
      // refocus effect in app.tsx does not fire when the panel disappears.
      const stillThere = payload.pipeline.jobs.some((job) => job.id === get().selectedJobId);
      set({
        // `text` must follow: opaque-block ranges come from the new pipeline, and the watcher
        // silences the server's own writes, so no reload would repair it.
        text: payload.text,
        included: payload.included,
        coverage: payload.coverage,
        pipeline: payload.pipeline,
        diagnostics: payload.diagnostics,
        hash: payload.hash,
        selectedJobId: stillThere ? get().selectedJobId : null,
        error: null,
      });
    };

    /** A `coverage.changed` saw another hash during an operation: the operation's response decides,
     *  and only a failure without a 409 leaves the reload still to do. */
    let reloadOwed = false;

    const reload = async (file: string, notice: Notice): Promise<void> => {
      const result = await dependencies.document(file);
      if (get().file !== file) {
        return;
      }
      clearHistory();

      if (!result.ok) {
        set({ status: "removed", error: result.error, selectedJobId: null });
        return;
      }

      const stillThere = result.value.pipeline.jobs.some((job) => job.id === get().selectedJobId);
      set({
        text: result.value.text,
        included: result.value.included,
        coverage: result.value.coverage,
        pipeline: result.value.pipeline,
        diagnostics: result.value.diagnostics,
        hash: result.value.hash,
        status: "ready",
        selectedJobId: stillThere ? get().selectedJobId : null,
        error: null,
        notice,
      });
    };

    const send = async (
      op: Operation,
      entry: HistoryEntry | null,
      onSuccess: () => void,
    ): Promise<boolean> => {
      const file = get().file;
      if (file === null || !get().canEdit()) {
        return false;
      }

      // "Added" would be false as soon as the next operation runs, an Undo for instance.
      set({ pending: true, ...(get().notice?.kind === "written" ? { notice: null } : {}) });
      const result = await dependencies.submit(file, op, dependencies.newOpId());
      set({ pending: false });
      const owed = reloadOwed;
      reloadOwed = false;

      // The write happened on the file that was left: its response says nothing about the one
      // on screen.
      if (get().file !== file) {
        return false;
      }

      if (result.ok) {
        applyPayload(result.value);
        if (entry !== null) {
          entry.inverse = result.value.inverse;
        }
        onSuccess();
        return true;
      }

      if (result.error.status === 409) {
        // `reload` resets `error` to null: set the error after it, or the server's message is lost
        // and only the generic notice survives.
        await reload(file, {
          kind: "stale",
          message:
            "The file changed on disk. Your change was not applied; the document has been reloaded.",
        });
        set({ error: result.error });
        return false;
      }

      if (owed) {
        await reload(file, RELOADED);
      }
      set({ error: result.error });
      return false;
    };

    return {
      file: null,
      text: "",
      included: {},
      coverage: null,
      catalog: null,
      view: "pipeline",
      selectedLayer: null,
      catalogLayer: null,
      pipeline: null,
      diagnostics: [],
      hash: null,
      status: "loading",
      selectedJobId: null,
      error: null,
      notice: null,
      pending: false,
      files: [],

      workspaceLoaded(files) {
        set({ files });
      },

      async openFile(file) {
        if (file === get().file) {
          return;
        }
        clearHistory();
        set({ status: "loading", selectedJobId: null, error: null, notice: null });
        const result = await dependencies.document(file);
        if (result.ok) {
          get().documentLoaded(file, result.value);
          return;
        }
        set({ file, status: "removed", error: result.error });
      },

      readOnly() {
        const { file, files } = get();
        return files.find((entry) => entry.path === file)?.adapter === "github";
      },

      documentLoaded(file, payload) {
        clearHistory();
        set({
          file,
          text: payload.text,
          included: payload.included,
          coverage: payload.coverage,
          pipeline: payload.pipeline,
          diagnostics: payload.diagnostics,
          hash: payload.hash,
          status: "ready",
          selectedJobId: null,
          error: null,
          notice: null,
        });
      },

      workspaceEmpty() {
        clearHistory();
        set({ file: null, pipeline: null, status: "empty", diagnostics: [], hash: null });
      },

      selectJob(id) {
        set({ selectedJobId: id });
      },

      setView(view) {
        set({ view, selectedLayer: null, catalogLayer: null, selectedJobId: null });
        if (view === "catalog" || view === "toolchain") {
          void get().loadCatalog();
        }
      },

      selectLayer(layer) {
        set({ selectedLayer: get().selectedLayer === layer ? null : layer });
      },

      showTools(layer) {
        set({ view: "catalog", catalogLayer: layer, selectedLayer: null, selectedJobId: null });
        void get().loadCatalog();
      },

      async loadCatalog() {
        if (get().catalog !== null) {
          return;
        }
        const result = await dependencies.catalog();
        if (result.ok) {
          set({ catalog: result.value });
        } else {
          set({ error: result.error });
        }
      },

      /** The file is part of the key: two files each have offsets starting at zero, so a range
       *  from an included file would fall inside the range of a main-file job and select the
       *  wrong job. */
      selectByRange(file, range) {
        if (range === null) {
          set({ selectedJobId: null });
          return;
        }
        const job = get().pipeline?.jobs.find(
          (candidate) =>
            candidate.file === file &&
            range.start >= candidate.range.start &&
            range.start < candidate.range.end,
        );
        set({ selectedJobId: job?.id ?? null });
      },

      textOf(file) {
        const state = get();
        return file === state.file ? state.text : (state.included[file] ?? "");
      },

      canEdit() {
        const { status, diagnostics } = get();
        return status === "ready" && !diagnostics.some(blocksEditing) && !get().readOnly();
      },

      canUndo() {
        return undoStack.length > 0;
      },

      canRedo() {
        return redoStack.length > 0;
      },

      async submit(draft) {
        const hash = get().hash;
        if (hash === null) {
          return false;
        }
        const op = { v: 1, baseHash: hash, ...draft } as Operation;
        const entry: HistoryEntry = {
          redo: draft,
          inverse: { v: 1, baseHash: hash, kind: "splice", start: 0, end: 0, text: "" },
        };

        return send(op, entry, () => {
          undoStack = [...undoStack, entry];
          redoStack = [];
        });
      },

      async undo() {
        const entry = undoStack.at(-1);
        const hash = get().hash;
        if (entry === undefined || hash === null) {
          return;
        }

        const op: Operation = { ...entry.inverse, baseHash: hash };
        await send(op, null, () => {
          undoStack = undoStack.slice(0, -1);
          redoStack = [...redoStack, entry];
        });
      },

      async redo() {
        const entry = redoStack.at(-1);
        const hash = get().hash;
        if (entry === undefined || hash === null) {
          return;
        }

        const op = { v: 1, baseHash: hash, ...entry.redo } as Operation;
        const replay: HistoryEntry = { redo: entry.redo, inverse: entry.inverse };
        await send(op, replay, () => {
          redoStack = redoStack.slice(0, -1);
          undoStack = [...undoStack, replay];
        });
      },

      async serverEvent(event) {
        if (event.file !== get().file) {
          return;
        }

        if (event.kind === "document.removed") {
          clearHistory();
          set({
            status: "removed",
            notice: { kind: "removed", message: "The file was deleted on disk." },
          });
          return;
        }

        if (event.kind === "coverage.changed") {
          const known = get().hash;
          const result = await dependencies.document(event.file);
          if (!result.ok) {
            return;
          }
          if (result.value.hash === get().hash) {
            set({ coverage: result.value.coverage, diagnostics: result.value.diagnostics });
            return;
          }
          // Another hash with no operation from this client: the server does not broadcast its
          // own writes, so no `document.changed` will follow. With an operation, its response wins.
          if (get().hash !== known) {
            return;
          }
          if (get().pending) {
            reloadOwed = true;
            return;
          }
          await reload(event.file, RELOADED);
          return;
        }

        await reload(event.file, RELOADED);
      },

      announceOpened(file, historyLost) {
        const suffix = historyLost ? " Undo history of the previous file was cleared." : "";
        set({ notice: { kind: "opened", message: `${file} opened.${suffix}` } });
      },

      announce(message) {
        set({ notice: { kind: "written", message } });
      },

      dismissNotice() {
        set({ notice: null });
      },

      dismissError() {
        set({ error: null });
      },
    };
  });
}
