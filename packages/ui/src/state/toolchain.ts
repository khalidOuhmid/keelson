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
  /** An event heard during an operation: once it is done, the disk must be checked, since no other
   *  event will follow. */
  let announced = false;
  /** Counts the operations sent: a disk read that overlaps one says nothing about the result. */
  let writes = 0;
  /** The nodes dropped whose position is not saved yet, with the move that placed them. */
  const moving = new Map<string, { position: Position; move: number }>();
  let moves = 0;

  return createStore<ToolchainState>((set, get) => {
    const placed = (payload: ToolchainPayload): ToolchainPayload =>
      moving.size === 0
        ? payload
        : {
            ...payload,
            positions: {
              ...payload.positions,
              ...Object.fromEntries([...moving].map(([node, entry]) => [node, entry.position])),
            },
          };

    const reload = async (): Promise<void> => {
      undoStack = [];
      redoStack = [];
      const result = await dependencies.load();
      if (result.ok) {
        set({ payload: placed(result.value) });
      } else {
        set({ error: result.error });
      }
    };

    /** An event carries only a hash, and the server's debounce merges or drops echoes: the disk
     *  itself says whether someone else wrote. */
    const verify = async (): Promise<void> => {
      const before = writes;
      const result = await dependencies.load();
      if (get().pending) {
        announced = true;
        return;
      }
      if (writes !== before) {
        await verify();
        return;
      }
      if (!result.ok) {
        set({ error: result.error });
        return;
      }
      if (result.value.hash === get().payload?.hash) {
        return;
      }
      undoStack = [];
      redoStack = [];
      set({ payload: placed(result.value), notice: RELOADED });
    };

    const send = async (
      op: ToolchainOperation,
      onSuccess: (inverse: SpliceOperation) => void,
    ): Promise<boolean> => {
      writes += 1;
      set({ pending: true, error: null });
      const result = await dependencies.submit(op, dependencies.newOpId());
      set({ pending: false });
      const heard = announced;
      announced = false;

      if (result.ok) {
        const { inverse, ...payload } = result.value;
        onSuccess(inverse);
        set({ payload: placed(payload) });
        if (heard) {
          await verify();
        }
        return true;
      }
      if (result.error.status === 409) {
        await reload();
        set({ error: result.error });
        return false;
      }
      set({ error: result.error });
      if (heard) {
        await verify();
      }
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
          set({ payload: placed(result.value) });
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
        if (hash === get().payload?.hash) {
          return;
        }
        if (get().pending) {
          announced = true;
          return;
        }
        await verify();
      },

      async move(node, position) {
        const payload = get().payload;
        if (payload === null) {
          return;
        }
        moves += 1;
        const move = moves;
        moving.set(node, { position, move });
        set({ payload: placed(payload) });
        const result = await dependencies.savePositions({ [node]: position });
        if (moving.get(node)?.move === move) {
          moving.delete(node);
        }
        if (result.ok) {
          const current = get().payload;
          if (current !== null) {
            set({ payload: placed({ ...current, positions: result.value.positions }) });
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
