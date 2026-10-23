import type { Diagnostic, Operation, Pipeline, SourceRange, SpliceOperation } from "@keelson/core";
import { INVALID_YAML } from "@keelson/core";
import { createStore as createZustandStore, type StoreApi } from "zustand/vanilla";
import type { ApiFailure, ApiResult, DocumentPayload, OperationPayload } from "../api/client.ts";
import type { ServerEvent } from "../api/events.ts";

export type Draft = Operation extends infer T
  ? T extends { v: 1; baseHash: string }
    ? Omit<T, "v" | "baseHash">
    : never
  : never;

export type Notice =
  | { kind: "stale"; message: string }
  | { kind: "reloaded"; message: string }
  | { kind: "removed"; message: string };

export type Status = "loading" | "ready" | "removed" | "empty";

/** Seul un document que l'IR ne peut pas modéliser interdit l'édition : une erreur de validation
 *  comme UNKNOWN_NEED se corrige justement en éditant. */
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
  newOpId: () => string;
};

export type KeelsonState = {
  file: string | null;
  text: string;
  /** Le texte de chaque fichier inclus, par chemin. `textOf` lit ici ou dans `text` : une plage
   *  venue d'un fichier inclus découpée dans le texte du fichier principal rendrait des octets
   *  pris ailleurs. */
  included: Record<string, string>;
  pipeline: Pipeline | null;
  diagnostics: Diagnostic[];
  hash: string | null;
  status: Status;
  selectedJobId: string | null;
  error: ApiFailure | null;
  notice: Notice | null;
  pending: boolean;

  documentLoaded(file: string, payload: DocumentPayload): void;
  workspaceEmpty(): void;
  selectJob(id: string | null): void;
  selectByRange(file: string, range: SourceRange | null): void;
  textOf(file: string): string;
  canEdit(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  submit(draft: Draft): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  serverEvent(event: ServerEvent): Promise<void>;
  dismissNotice(): void;
  dismissError(): void;
};

export type KeelsonStore = StoreApi<KeelsonState>;

export function createStore(dependencies: StoreDependencies): KeelsonStore {
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];

  return createZustandStore<KeelsonState>()((set, get) => {
    const clearHistory = (): void => {
      undoStack = [];
      redoStack = [];
    };

    const applyPayload = (payload: OperationPayload): void => {
      // La selection doit tomber si le job vient d'etre supprime — `reload` le fait deja. Sans
      // cela l'id reste pendant, le panneau se rouvrirait sur un job recree du meme nom, et
      // l'effet de refocalisation d'app.tsx ne tire pas quand le panneau disparait.
      const stillThere = payload.pipeline.jobs.some((job) => job.id === get().selectedJobId);
      set({
        // `text` doit suivre : les plages des blocs opaques viennent du nouveau pipeline, et le
        // watcher tait les ecritures propres du serveur, donc aucun rechargement ne le reparerait.
        text: payload.text,
        included: payload.included,
        pipeline: payload.pipeline,
        diagnostics: payload.diagnostics,
        hash: payload.hash,
        selectedJobId: stillThere ? get().selectedJobId : null,
        error: null,
      });
    };

    const reload = async (file: string, notice: Notice): Promise<void> => {
      const result = await dependencies.document(file);
      clearHistory();

      if (!result.ok) {
        set({ status: "removed", error: result.error, selectedJobId: null });
        return;
      }

      const stillThere = result.value.pipeline.jobs.some((job) => job.id === get().selectedJobId);
      set({
        text: result.value.text,
        included: result.value.included,
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
    ): Promise<void> => {
      const file = get().file;
      if (file === null || !get().canEdit()) {
        return;
      }

      set({ pending: true });
      const result = await dependencies.submit(file, op, dependencies.newOpId());
      set({ pending: false });

      if (result.ok) {
        applyPayload(result.value);
        if (entry !== null) {
          entry.inverse = result.value.inverse;
        }
        onSuccess();
        return;
      }

      if (result.error.status === 409) {
        // `reload` remet `error` à null : poser l'erreur après lui, sinon le message du serveur est
        // perdu et seul l'avis générique survit.
        await reload(file, {
          kind: "stale",
          message:
            "The file changed on disk. Your change was not applied; the document has been reloaded.",
        });
        set({ error: result.error });
        return;
      }

      set({ error: result.error });
    };

    return {
      file: null,
      text: "",
      included: {},
      pipeline: null,
      diagnostics: [],
      hash: null,
      status: "loading",
      selectedJobId: null,
      error: null,
      notice: null,
      pending: false,

      documentLoaded(file, payload) {
        clearHistory();
        set({
          file,
          text: payload.text,
          included: payload.included,
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

      /** Le fichier fait partie de la clé : deux fichiers ont chacun leurs offsets à partir de
       *  zéro, donc une plage venue d'un fichier inclus tomberait dans la plage d'un job du
       *  fichier principal et sélectionnerait le mauvais job. */
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
        return status === "ready" && !diagnostics.some(blocksEditing);
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
          return;
        }
        const op = { v: 1, baseHash: hash, ...draft } as Operation;
        const entry: HistoryEntry = {
          redo: draft,
          inverse: { v: 1, baseHash: hash, kind: "splice", start: 0, end: 0, text: "" },
        };

        await send(op, entry, () => {
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

        await reload(event.file, {
          kind: "reloaded",
          message: "The file changed on disk and was reloaded.",
        });
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
