import type { SpliceOperation, ToolchainOperation } from "@keelson/core";
import type { Position, Positions } from "@keelson/toolchain";
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ApiFailure,
  ApiResult,
  ToolchainOperationPayload,
  ToolchainPayload,
} from "../api/client.ts";

export type ToolchainDraft = ToolchainOperation extends infer O
  ? O extends ToolchainOperation
    ? Omit<O, "v" | "baseHash">
    : never
  : never;

export type ToolchainDependencies = {
  load: () => Promise<ApiResult<ToolchainPayload>>;
  submit: (op: ToolchainOperation, opId: string) => Promise<ApiResult<ToolchainOperationPayload>>;
  savePositions: (positions: Positions) => Promise<ApiResult<{ positions: Positions }>>;
  newOpId: () => string;
};

export type ToolchainState = {
  payload: ToolchainPayload | null;
  error: ApiFailure | null;
  pending: boolean;
  selectedService: string | null;
  load(): Promise<void>;
  /** Le pipeline a bougé : les propositions changent, l'historique du fichier non. */
  refresh(): Promise<void>;
  /** `true` si l'écriture a eu lieu : un formulaire ne se vide qu'à cette condition. */
  submit(draft: ToolchainDraft): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** `toolchain.changed` : le hash connu veut dire que c'est notre propre écriture. */
  changed(hash: string): Promise<void>;
  move(node: string, position: Position): Promise<void>;
  selectService(id: string | null): void;
  dismissError(): void;
};

export type ToolchainStore = StoreApi<ToolchainState>;

export function createToolchainStore(dependencies: ToolchainDependencies): ToolchainStore {
  let undoStack: SpliceOperation[] = [];
  let redoStack: SpliceOperation[] = [];

  return createStore<ToolchainState>((set, get) => {
    const reload = async (): Promise<void> => {
      undoStack = [];
      redoStack = [];
      const result = await dependencies.load();
      if (result.ok) {
        set({ payload: result.value });
      } else {
        set({ error: result.error });
      }
    };

    const send = async (
      op: ToolchainOperation,
      onSuccess: (inverse: SpliceOperation) => void,
    ): Promise<boolean> => {
      set({ pending: true, error: null });
      const result = await dependencies.submit(op, dependencies.newOpId());
      set({ pending: false });

      if (result.ok) {
        const { inverse, ...payload } = result.value;
        onSuccess(inverse);
        set({ payload });
        return true;
      }
      if (result.error.status === 409) {
        await reload();
      }
      set({ error: result.error });
      return false;
    };

    return {
      payload: null,
      error: null,
      pending: false,
      selectedService: null,

      load: reload,

      async refresh() {
        const result = await dependencies.load();
        if (result.ok && result.value.hash === get().payload?.hash) {
          set({ payload: result.value });
        }
      },

      async submit(draft) {
        const hash = get().payload?.hash;
        if (hash === undefined) {
          return false;
        }
        return send({ v: 1, baseHash: hash, ...draft } as ToolchainOperation, (inverse) => {
          undoStack.push(inverse);
          redoStack = [];
        });
      },

      async undo() {
        const inverse = undoStack.at(-1);
        if (inverse !== undefined) {
          await send(inverse, (next) => {
            undoStack.pop();
            redoStack.push(next);
          });
        }
      },

      async redo() {
        const inverse = redoStack.at(-1);
        if (inverse !== undefined) {
          await send(inverse, (next) => {
            redoStack.pop();
            undoStack.push(next);
          });
        }
      },

      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,

      async changed(hash) {
        if (hash !== get().payload?.hash && !get().pending) {
          await reload();
        }
      },

      async move(node, position) {
        const payload = get().payload;
        if (payload === null) {
          return;
        }
        const positions = { ...payload.positions, [node]: position };
        set({ payload: { ...payload, positions } });
        const result = await dependencies.savePositions(positions);
        if (!result.ok) {
          set({ error: result.error });
        }
      },

      selectService: (id) => set({ selectedService: id }),
      dismissError: () => set({ error: null }),
    };
  });
}
