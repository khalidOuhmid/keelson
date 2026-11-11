import type { SpliceOperation, ToolchainOperation } from "@keelson/core";
import type { Position, Positions } from "@keelson/toolchain";
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ApiFailure,
  ApiResult,
  ToolchainOperationPayload,
  ToolchainPayload,
} from "../api/client.ts";
import type { Notice } from "./store.ts";

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
  notice: Notice | null;
  pending: boolean;
  selectedService: string | null;
  load(): Promise<void>;
  /** The pipeline moved: proposals change, the file's history does not. */
  refresh(): Promise<void>;
  /** `true` if the write happened: a form is cleared only on that condition. */
  submit(draft: ToolchainDraft): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** `toolchain.changed`: a known hash means it is our own write. */
  changed(hash: string): Promise<void>;
  move(node: string, position: Position): Promise<void>;
  selectService(id: string | null): void;
  dismissError(): void;
  dismissNotice(): void;
};

const RELOADED: Notice = {
  kind: "reloaded",
  message: "toolchain.yaml changed on disk and was reloaded.",
};

export type ToolchainStore = StoreApi<ToolchainState>;

export function createToolchainStore(dependencies: ToolchainDependencies): ToolchainStore {
  let undoStack: SpliceOperation[] = [];
  let redoStack: SpliceOperation[] = [];
  /** The hash announced during an operation: once it is done, only this hash tells whether the
   *  disk changed elsewhere. No other event will follow. */
  let announced: string | null = null;
  /** The hashes this client wrote whose echo has not arrived yet, oldest first. An echo consumes
   *  its entry and the earlier ones, which the server's debounce may have merged: past the echo,
   *  that same hash comes from someone else. */
  let awaitingEcho: string[] = [];

  return createStore<ToolchainState>((set, get) => {
    const reload = async (): Promise<void> => {
      undoStack = [];
      redoStack = [];
      awaitingEcho = [];
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
      const heard = announced;
      announced = null;

      if (result.ok) {
        const { inverse, ...payload } = result.value;
        awaitingEcho.push(payload.hash);
        onSuccess(inverse);
        set({ payload });
        if (heard !== null && heard !== payload.hash) {
          await reload();
          set({ notice: RELOADED });
        }
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
      notice: null,
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
        if (inverse !== undefined && !get().pending) {
          await send(inverse, (next) => {
            undoStack.pop();
            redoStack.push(next);
          });
        }
      },

      async redo() {
        const inverse = redoStack.at(-1);
        if (inverse !== undefined && !get().pending) {
          await send(inverse, (next) => {
            redoStack.pop();
            undoStack.push(next);
          });
        }
      },

      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,

      async changed(hash) {
        const echo = awaitingEcho.lastIndexOf(hash);
        if (echo !== -1) {
          awaitingEcho = awaitingEcho.slice(echo + 1);
          return;
        }
        if (hash === get().payload?.hash) {
          return;
        }
        if (get().pending) {
          announced = hash;
          return;
        }
        await reload();
        set({ notice: RELOADED });
      },

      async move(node, position) {
        const payload = get().payload;
        if (payload === null) {
          return;
        }
        set({ payload: { ...payload, positions: { ...payload.positions, [node]: position } } });
        const result = await dependencies.savePositions({ [node]: position });
        if (result.ok) {
          const current = get().payload;
          if (current !== null) {
            set({ payload: { ...current, positions: result.value.positions } });
          }
          return;
        }
        set({ error: result.error });
        await get().refresh();
      },

      selectService: (id) => set({ selectedService: id }),
      dismissError: () => set({ error: null }),
      dismissNotice: () => set({ notice: null }),
    };
  });
}
