import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  type ApiResult,
  type DocumentPayload,
  KeelsonClient,
  type OperationPayload,
} from "./api/client.ts";
import { type ServerEvent, subscribe as subscribeToEvents } from "./api/events.ts";
import { browserLocation, readToken } from "./api/token.ts";
import { ErrorBanner } from "./editing/ErrorBanner.tsx";
import { HistoryControls } from "./editing/HistoryControls.tsx";
import { JobEditor } from "./editing/JobEditor.tsx";
import { NewJobForm } from "./editing/NewJobForm.tsx";
import { StageControls } from "./editing/StageControls.tsx";
import { useHistoryShortcuts } from "./editing/useHistoryShortcuts.ts";
import { DiagnosticsPanel } from "./panels/DiagnosticsPanel.tsx";
import { JobDetailPanel } from "./panels/JobDetailPanel.tsx";
import { blocksEditing, createStore, type KeelsonStore } from "./state/store.ts";
import { DocumentRemoved } from "./states/DocumentRemoved.tsx";
import { InvalidDocument } from "./states/InvalidDocument.tsx";
import { Loading } from "./states/Loading.tsx";
import { NoCiFile } from "./states/NoCiFile.tsx";
import { NoticeBar } from "./states/NoticeBar.tsx";
import { PipelineCanvas } from "./views/pipeline/PipelineCanvas.tsx";

type ClientSurface = {
  workspace: () => Promise<ApiResult<{ files: { path: string; adapter: "gitlab" }[] }>>;
  document: (file: string) => Promise<ApiResult<DocumentPayload>>;
  submit: (
    file: string,
    op: Parameters<KeelsonClient["submit"]>[1],
    opId: string,
  ) => Promise<ApiResult<OperationPayload>>;
  eventsUrl: () => string;
};

export type AppDeps = {
  client: ClientSurface;
  subscribe?: typeof subscribeToEvents;
  newOpId?: () => string;
};

function browserDeps(): AppDeps {
  const token = readToken(browserLocation()) ?? "";
  return { client: new KeelsonClient({ token }) };
}

export type AppProps = {
  deps?: AppDeps;
};

export function App({ deps }: AppProps = {}) {
  const resolved = useMemo(() => deps ?? browserDeps(), [deps]);
  const store = useMemo<KeelsonStore>(
    () =>
      createStore({
        submit: (file, op, opId) => resolved.client.submit(file, op, opId),
        document: (file) => resolved.client.document(file),
        newOpId: resolved.newOpId ?? (() => crypto.randomUUID()),
      }),
    [resolved],
  );

  const state = useStore(store);
  const [root, setRoot] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) {
      return;
    }
    loaded.current = true;

    void (async () => {
      const workspace = await resolved.client.workspace();
      if (!workspace.ok) {
        store.getState().workspaceEmpty();
        return;
      }

      const first = workspace.value.files[0];
      if (first === undefined) {
        store.getState().workspaceEmpty();
        return;
      }

      setRoot(first.path);
      const document = await resolved.client.document(first.path);
      if (document.ok) {
        store.getState().documentLoaded(first.path, document.value);
        return;
      }
      store.getState().workspaceEmpty();
    })();
  }, [resolved, store]);

  useEffect(() => {
    const listen = resolved.subscribe ?? subscribeToEvents;
    const subscription = listen(resolved.client.eventsUrl(), (event: ServerEvent) => {
      void store.getState().serverEvent(event);
    });
    return () => subscription.close();
  }, [resolved, store]);

  // Échap referme le panneau de détail. L'écouteur est au niveau du document : la sélection se
  // désigne au canevas mais se referme depuis n'importe où, panneau compris.
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        store.getState().selectJob(null);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [store]);

  // Une opération en vol désactive l'édition : sans cela chaque contrôle reste actif et une
  // seconde soumission part sur un hash déjà périmé.
  const editable = state.canEdit() && !state.pending;

  useHistoryShortcuts({
    enabled: editable,
    onUndo: () => void store.getState().undo(),
    onRedo: () => void store.getState().redo(),
  });

  const selected =
    state.selectedJobId === null
      ? null
      : (state.pipeline?.jobs.find((job) => job.id === state.selectedJobId) ?? null);

  const blocking = state.diagnostics.some(blocksEditing);

  const body = (() => {
    if (state.status === "loading") {
      return <Loading />;
    }
    if (state.status === "empty") {
      return <NoCiFile root={root === "" ? "this folder" : root} />;
    }
    if (state.status === "removed") {
      return <DocumentRemoved file={state.file ?? root} />;
    }
    if (blocking) {
      return <InvalidDocument diagnostics={state.diagnostics} />;
    }
    return (
      <PipelineCanvas
        pipeline={state.pipeline ?? { stages: [], jobs: [], templates: [], opaque: [] }}
        selectedJobId={state.selectedJobId}
        onSelectJob={(id) => store.getState().selectJob(id)}
      />
    );
  })();

  const showSidebar = state.status === "ready" && !blocking && state.pipeline !== null;

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <NoticeBar notice={state.notice} onDismiss={() => store.getState().dismissNotice()} />
      <ErrorBanner error={state.error} onDismiss={() => store.getState().dismissError()} />

      <header className="flex h-[var(--keelson-header-height)] shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-3">
        <span className="flex items-baseline gap-2 overflow-hidden">
          <span className="text-sm font-semibold text-text-primary">Keelson</span>
          {state.file === null ? null : (
            <span className="truncate font-mono text-xs text-text-muted">{state.file}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {state.pending ? (
            <span
              data-testid="pending-indicator"
              role="status"
              className="flex items-center gap-1.5 font-mono text-2xs tracking-label text-text-muted uppercase"
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
              Writing
            </span>
          ) : null}
          <HistoryControls
            canUndo={state.canUndo()}
            canRedo={state.canRedo()}
            onUndo={() => void store.getState().undo()}
            onRedo={() => void store.getState().redo()}
          />
        </span>
      </header>

      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {showSidebar && state.pipeline !== null ? (
          <aside className="flex w-[var(--keelson-panel-width)] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-surface-1 p-3">
            <StageControls
              pipeline={state.pipeline}
              onSubmit={(draft) => void store.getState().submit(draft)}
              disabled={!editable}
            />
            <NewJobForm
              pipeline={state.pipeline}
              onSubmit={(draft) => void store.getState().submit(draft)}
              disabled={!editable}
            />
          </aside>
        ) : null}

        <main className="min-w-[var(--keelson-canvas-min-width)] flex-1">{body}</main>

        {selected === null || state.pipeline === null ? null : (
          <aside className="w-[var(--keelson-panel-width)] shrink-0 overflow-y-auto">
            <JobDetailPanel
              job={selected}
              text={state.text}
              onClose={() => store.getState().selectJob(null)}
            />
            <div className="border-l border-border-subtle bg-surface-1 p-3">
              <JobEditor
                key={selected.id}
                job={selected}
                pipeline={state.pipeline}
                onSubmit={(draft) => void store.getState().submit(draft)}
                disabled={!editable}
              />
            </div>
          </aside>
        )}
      </div>

      <div className="max-h-1/3 shrink-0 overflow-y-auto">
        <DiagnosticsPanel
          diagnostics={state.diagnostics}
          onSelectRange={(range) => store.getState().selectByRange(range)}
        />
      </div>
    </div>
  );
}
