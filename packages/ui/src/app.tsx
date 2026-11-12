import { type Coverage, lowerBoundCause } from "@keelson/catalog";
import {
  emptyPipeline,
  isPartial,
  type Operation,
  TOOLCHAIN_INVALID,
  type ToolchainOperation,
} from "@keelson/core";
import type { Positions } from "@keelson/toolchain";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { fileInAddress, rememberFile } from "./api/address.ts";
import {
  type ApiResult,
  type CatalogPayload,
  type DocumentPayload,
  KeelsonClient,
  type OperationPayload,
  type RepositoryCoveragePayload,
  type ToolchainOperationPayload,
  type ToolchainPayload,
  type WorkspaceFile,
} from "./api/client.ts";
import { type ServerEvent, subscribe as subscribeToEvents } from "./api/events.ts";
import { browserLocation, readToken } from "./api/token.ts";
import { BUTTON, FIELD, SECTION_HEADING } from "./editing/controls.ts";
import { ErrorBanner } from "./editing/ErrorBanner.tsx";
import { HistoryControls } from "./editing/HistoryControls.tsx";
import { JobEditor } from "./editing/JobEditor.tsx";
import { NewJobForm } from "./editing/NewJobForm.tsx";
import { StageControls } from "./editing/StageControls.tsx";
import { useHistoryShortcuts } from "./editing/useHistoryShortcuts.ts";
import { focusWhenDrawn, keepFocusThrough, overlaysCover, useCoveringPanel } from "./focus.ts";
import { DiagnosticsPanel } from "./panels/DiagnosticsPanel.tsx";
import { IncludedFileView } from "./panels/IncludedFileView.tsx";
import { JobDetailPanel } from "./panels/JobDetailPanel.tsx";
import { blocksEditing, createStore, type Draft, type KeelsonStore } from "./state/store.ts";
import { createToolchainStore, type ToolchainStore } from "./state/toolchain.ts";
import { DocumentRemoved } from "./states/DocumentRemoved.tsx";
import { InvalidDocument } from "./states/InvalidDocument.tsx";
import { Loading } from "./states/Loading.tsx";
import { NoCiFile } from "./states/NoCiFile.tsx";
import { NoticeBar } from "./states/NoticeBar.tsx";
import { PartialPipelineBar } from "./states/PartialPipelineBar.tsx";
import { CatalogView } from "./views/catalog/CatalogView.tsx";
import { CoveragePanel } from "./views/coverage/CoveragePanel.tsx";
import { JobSearch } from "./views/pipeline/JobSearch.tsx";
import { PipelineCanvas } from "./views/pipeline/PipelineCanvas.tsx";
import { PipelineTable } from "./views/pipeline/PipelineTable.tsx";
import { ServicePanel } from "./views/toolchain/ServicePanel.tsx";
import { ToolchainCanvas } from "./views/toolchain/ToolchainCanvas.tsx";
import { ToolchainPanel } from "./views/toolchain/ToolchainPanel.tsx";

const VIEWS = [
  { view: "pipeline", label: "Pipeline" },
  { view: "toolchain", label: "Toolchain" },
  { view: "coverage", label: "Coverage" },
  { view: "catalog", label: "Catalog" },
] as const;

type ClientSurface = {
  workspace: () => Promise<ApiResult<{ files: WorkspaceFile[] }>>;
  document: (file: string) => Promise<ApiResult<DocumentPayload>>;
  submit: (
    file: string,
    op: Parameters<KeelsonClient["submit"]>[1],
    opId: string,
  ) => Promise<ApiResult<OperationPayload>>;
  catalog: () => Promise<ApiResult<CatalogPayload>>;
  preview: (file: string, op: Operation) => Promise<ApiResult<OperationPayload>>;
  toolchain: () => Promise<ApiResult<ToolchainPayload>>;
  submitToolchain: (
    op: ToolchainOperation,
    opId: string,
  ) => Promise<ApiResult<ToolchainOperationPayload>>;
  savePositions: (positions: Positions) => Promise<ApiResult<{ positions: Positions }>>;
  clearPositions: () => Promise<ApiResult<{ positions: Positions }>>;
  repositoryCoverage: () => Promise<ApiResult<RepositoryCoveragePayload>>;
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

/** A titled section, separated from the next one by a rule. `role="group"` rather than `<section>`:
 *  the sidebar must not add a navigation landmark per block of controls. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls must not become a landmark; fieldset is reserved for forms
    <div
      role="group"
      aria-label={title}
      className="flex flex-col gap-2 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0"
    >
      <h2 className={SECTION_HEADING}>{title}</h2>
      {children}
    </div>
  );
}

const DISPLAYS = [
  { display: "graph", label: "Graph" },
  { display: "table", label: "Table" },
] as const;

type Display = (typeof DISPLAYS)[number]["display"];

export function App({ deps }: AppProps = {}) {
  const resolved = useMemo(() => deps ?? browserDeps(), [deps]);
  const store = useMemo<KeelsonStore>(
    () =>
      createStore({
        submit: (file, op, opId) => resolved.client.submit(file, op, opId),
        document: (file) => resolved.client.document(file),
        catalog: () => resolved.client.catalog(),
        newOpId: resolved.newOpId ?? (() => crypto.randomUUID()),
      }),
    [resolved],
  );

  const toolchainStore = useMemo<ToolchainStore>(
    () =>
      createToolchainStore({
        load: () => resolved.client.toolchain(),
        submit: (op, opId) => resolved.client.submitToolchain(op, opId),
        savePositions: (positions) => resolved.client.savePositions(positions),
        clearPositions: () => resolved.client.clearPositions(),
        newOpId: resolved.newOpId ?? (() => crypto.randomUUID()),
      }),
    [resolved],
  );
  const state = useStore(store);
  const toolchainState = useStore(toolchainStore);

  useEffect(() => {
    void toolchainStore.getState().load();
  }, [toolchainStore]);

  // Proposals depend on the pipeline: an added or renamed job changes them.
  useEffect(() => {
    if (state.hash !== null) {
      void toolchainStore.getState().refresh();
    }
  }, [toolchainStore, state.hash]);
  const [root, setRoot] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarOpenNow = useRef(false);
  sidebarOpenNow.current = sidebarOpen;
  const panelTrigger = useRef<HTMLButtonElement | null>(null);
  const closeSidebar = (): void => {
    setSidebarOpen(false);
    panelTrigger.current?.focus();
  };
  const sidebar = useCoveringPanel<HTMLElement>(sidebarOpen);
  const [display, setDisplay] = useState<Display>("graph");
  const [searchOpen, setSearchOpen] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const readingNow = useRef<string | null>(null);
  readingNow.current = reading;
  const readTrigger = useRef<HTMLElement | null>(null);
  const readFile = (file: string, trigger: HTMLElement): void => {
    readTrigger.current = trigger;
    setReading(file);
  };
  const closeFile = (): void => {
    setReading(null);
    readTrigger.current?.focus();
  };
  const searchTrigger = useRef<HTMLButtonElement | null>(null);
  const loaded = useRef(false);

  const opening = useRef(0);
  const openFile = async (path: string): Promise<void> => {
    opening.current += 1;
    const turn = opening.current;
    const hadHistory = store.getState().canUndo();
    const document = await resolved.client.document(path);
    if (turn !== opening.current) {
      return;
    }
    if (!document.ok) {
      store.setState({ error: document.error });
      return;
    }
    store.getState().documentLoaded(path, document.value);
    store.getState().announceOpened(path, hadHistory);
    rememberFile(path);
  };

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

      const named = fileInAddress(window.location.hash);
      const first =
        workspace.value.files.find((entry) => entry.path === named) ?? workspace.value.files[0];
      if (first === undefined) {
        store.getState().workspaceEmpty();
        return;
      }

      setRoot(first.path);
      store.getState().workspaceLoaded(workspace.value.files);
      const document = await resolved.client.document(first.path);
      if (document.ok) {
        store.getState().documentLoaded(first.path, document.value);
        rememberFile(first.path);
        return;
      }
      store.getState().workspaceEmpty();
    })();
  }, [resolved, store]);

  useEffect(() => {
    const listen = resolved.subscribe ?? subscribeToEvents;
    const subscription = listen(resolved.client.eventsUrl(), (event: ServerEvent) => {
      if (event.kind === "toolchain.changed") {
        void toolchainStore.getState().changed(event.hash);
        return;
      }
      void store.getState().serverEvent(event);
      // `layout.json` may have changed: positions written by someone else arrive here.
      if (event.kind === "coverage.changed") {
        void toolchainStore.getState().refresh();
      }
    });
    return () => subscription.close();
  }, [resolved, store, toolchainStore]);

  // When the detail panel goes away — Escape, close button or confirmed deletion — focus returns
  // to the job's node, or to the graph once the job is gone, never to <body>.
  const lastSelection = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastSelection.current;
    if (previous !== null && state.selectedJobId === null) {
      const remains = store.getState().pipeline?.jobs.some((job) => job.id === previous) ?? false;
      (
        (remains
          ? document.querySelector<HTMLElement>(`[data-job-id="${CSS.escape(previous)}"]`)
          : null) ??
        document.querySelector<HTMLElement>('[aria-label="Pipeline graph"]') ??
        document.querySelector<HTMLElement>('[aria-label="Display"] [aria-pressed="true"]')
      )?.focus();
    }
    lastSelection.current = state.selectedJobId;
  }, [state.selectedJobId, store]);

  const serviceOpen =
    state.view === "toolchain" &&
    (toolchainState.payload?.toolchain.services.some(
      (service) => service.id === toolchainState.selectedService,
    ) ??
      false);
  const hadService = useRef(false);
  useEffect(() => {
    const typing = document.activeElement?.matches("input, select, textarea") ?? false;
    if (hadService.current && !serviceOpen && !typing) {
      document.querySelector<HTMLElement>('[aria-label="Toolchain graph"]')?.focus();
    }
    hadService.current = serviceOpen;
  }, [serviceOpen]);

  // Escape closes the detail panel. The listener sits on the document: a selection is made on the
  // canvas but can be closed from anywhere, the panel included.
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && readingNow.current !== null) {
        setReading(null);
        readTrigger.current?.focus();
        return;
      }
      if (event.key === "Escape" && sidebarOpenNow.current) {
        setSidebarOpen(false);
        panelTrigger.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        store.getState().selectJob(null);
        toolchainStore.getState().selectService(null);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [store, toolchainStore]);

  // An operation in flight disables editing: otherwise every control stays active and a second
  // submission goes out on an already stale hash.
  const editable = state.canEdit() && !state.pending;

  useHistoryShortcuts({
    enabled: editable && state.view === "pipeline",
    onUndo: () => void store.getState().undo(),
    onRedo: () => void store.getState().redo(),
  });

  const toolchainPayload = toolchainState.payload;
  const toolchainInvalid =
    toolchainPayload?.diagnostics.some((entry) => entry.code === TOOLCHAIN_INVALID) ?? false;
  const toolchainEditable =
    !toolchainState.pending && toolchainPayload !== null && !toolchainInvalid;
  const inToolchain = state.view === "toolchain";

  useHistoryShortcuts({
    enabled: toolchainEditable && inToolchain,
    onUndo: () => void toolchainStore.getState().undo(),
    onRedo: () => void toolchainStore.getState().redo(),
  });

  const selectedService = inToolchain
    ? (toolchainPayload?.toolchain.services.find(
        (service) => service.id === toolchainState.selectedService,
      ) ?? null)
    : null;
  const toolLabels = useMemo(
    () =>
      new Map(
        (state.catalog?.tools ?? []).map((tool) => [
          tool.id,
          {
            name: tool.name,
            logo: tool.logo === null ? null : (state.catalog?.logos[tool.logo]?.path ?? null),
          },
        ]),
      ),
    [state.catalog],
  );

  const selected =
    state.selectedJobId === null
      ? null
      : (state.pipeline?.jobs.find((job) => job.id === state.selectedJobId) ?? null);

  const blocking = state.diagnostics.some(blocksEditing);
  const searchable =
    state.status === "ready" &&
    !blocking &&
    state.pipeline !== null &&
    (state.view === "pipeline" || state.view === "coverage");
  const searchableNow = useRef(false);
  searchableNow.current = searchable;

  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (!searchableNow.current) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        (target?.matches("input, select, textarea") ?? false) || target?.isContentEditable === true;
      const shortcut =
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
        (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey);
      if (shortcut) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
  const jobPanelOpen =
    selected !== null && state.pipeline !== null && state.view !== "catalog" && !inToolchain;
  const jobPanel = useCoveringPanel<HTMLElement>(jobPanelOpen);
  const servicePanel = useCoveringPanel<HTMLElement>(selectedService !== null);
  const readingText = reading === null ? undefined : state.included[reading];
  const filePanel = useCoveringPanel<HTMLElement>(readingText !== undefined);

  const readingCoverage = state.view === "coverage";
  const [wholeRepository, setWholeRepository] = useState(false);
  const [repositoryCoverage, setRepositoryCoverage] = useState<Coverage | null>(null);
  const askedCoverage = useRef(0);
  const severalFiles = state.files.length > 1;
  // Re-read on every change of this file's coverage: a write or an event changed the disk.
  useEffect(() => {
    if (!readingCoverage || !wholeRepository || !severalFiles || state.coverage === null) {
      return;
    }
    askedCoverage.current += 1;
    const turn = askedCoverage.current;
    void resolved.client.repositoryCoverage().then((result) => {
      if (turn !== askedCoverage.current) {
        return;
      }
      if (result.ok) {
        setRepositoryCoverage(result.value.coverage);
      } else {
        store.setState({ error: result.error });
      }
    });
  }, [readingCoverage, wholeRepository, severalFiles, state.coverage, resolved, store]);
  const shownCoverage =
    wholeRepository && severalFiles && repositoryCoverage !== null
      ? repositoryCoverage
      : state.coverage;
  const overlay = useMemo(
    () =>
      readingCoverage
        ? {
            jobs: new Map(state.coverage?.jobs.map((job) => [job.job, job.layers]) ?? []),
            selected: state.selectedLayer,
          }
        : null,
    [readingCoverage, state.coverage, state.selectedLayer],
  );

  const files = state.files;
  const file = state.file;
  const hash = state.hash;
  const insertion = useMemo(
    () =>
      state.pipeline === null || file === null || hash === null
        ? undefined
        : {
            pipeline: state.pipeline,
            text: state.text,
            disabled: !editable,
            preview: (draft: Draft) =>
              resolved.client.preview(file, { v: 1, baseHash: hash, ...draft } as Operation),
            onInsert: async (draft: Draft, job: string) => {
              const written = await store.getState().submit(draft);
              if (!written) {
                return store.getState().error;
              }
              store.getState().setView("pipeline");
              store.getState().announce(`${job} added to ${file}.`);
              // Below `lg`, selecting would open an overlay on top of Undo and the node.
              if (window.matchMedia("(min-width: 64rem)").matches) {
                store.getState().selectJob(job);
              }
              focusWhenDrawn(`[data-job-id="${CSS.escape(job)}"]`);
              return null;
            },
          },
    [state.pipeline, state.text, file, hash, editable, resolved, store],
  );

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
    if (inToolchain) {
      return toolchainPayload === null ? (
        <Loading />
      ) : (
        <ToolchainCanvas
          payload={toolchainPayload}
          labels={toolLabels}
          selectedService={toolchainState.selectedService}
          onSelectService={(id) => toolchainStore.getState().selectService(id)}
          onMove={(node, position) => void toolchainStore.getState().move(node, position)}
          onResetLayout={() => void toolchainStore.getState().resetLayout()}
          invalid={toolchainInvalid}
        />
      );
    }
    if (state.view === "catalog") {
      return state.catalog === null ? (
        <Loading />
      ) : (
        <CatalogView
          key={`${state.file}:${state.catalogLayer ?? "any"}`}
          catalog={state.catalog}
          initialLayer={state.catalogLayer}
          insertion={insertion}
        />
      );
    }
    const shown = state.pipeline ?? emptyPipeline(state.file ?? "");
    return (
      <div className="flex h-full flex-col">
        {/* biome-ignore lint/a11y/useSemanticElements: a pair of toggle buttons, not a form */}
        <div
          role="group"
          aria-label="Display"
          className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-3 py-1.5"
        >
          {DISPLAYS.map((entry) => (
            <button
              key={entry.display}
              type="button"
              aria-pressed={display === entry.display}
              onClick={() => setDisplay(entry.display)}
              className={`${BUTTON} aria-pressed:border-accent aria-pressed:bg-surface-3 aria-pressed:font-semibold aria-pressed:text-text-primary`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {display === "graph" ? (
            <PipelineCanvas
              pipeline={shown}
              selectedJobId={state.selectedJobId}
              onSelectJob={(id) => store.getState().selectJob(id)}
              overlay={overlay}
            />
          ) : (
            <PipelineTable
              pipeline={shown}
              selectedJobId={state.selectedJobId}
              onSelectJob={(id) => store.getState().selectJob(id)}
              overlay={overlay}
            />
          )}
        </div>
      </div>
    );
  })();

  /** Resolved files other than the main one. `files` may contain the same one twice — GitLab
   *  does not deduplicate includes — but the count shown on screen is a count of **files**, not of
   *  entries. */
  const resolvedIncludes = [
    ...new Set((state.pipeline?.files ?? []).filter((file) => file !== state.pipeline?.main)),
  ];
  const includedCount = resolvedIncludes.length;

  const showSidebar = state.status === "ready" && !blocking && state.pipeline !== null;

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <NoticeBar notice={state.notice} onDismiss={() => store.getState().dismissNotice()} />
      <NoticeBar
        notice={toolchainState.notice}
        onDismiss={() => toolchainStore.getState().dismissNotice()}
      />
      <ErrorBanner error={state.error} onDismiss={() => store.getState().dismissError()} />
      <ErrorBanner
        error={toolchainState.error}
        onDismiss={() => toolchainStore.getState().dismissError()}
      />

      <header className="flex min-h-[var(--keelson-header-height)] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-1">
        <div className="-m-1 flex items-baseline gap-2 overflow-hidden p-1">
          <h1 className="text-sm font-semibold text-text-primary">Keelson</h1>
          {state.file === null ? null : files.length > 1 ? (
            <select
              aria-label="Pipeline file"
              title={state.file}
              disabled={state.pending}
              className={`${FIELD} w-auto min-w-0 max-w-[var(--keelson-panel-width)]`}
              value={state.file}
              onChange={(event) => void openFile(event.target.value)}
            >
              {files.some((entry) => entry.adapter === "gitlab") ? (
                <optgroup label="GitLab CI">
                  {files
                    .filter((entry) => entry.adapter === "gitlab")
                    .map((entry) => (
                      <option key={entry.path} value={entry.path}>
                        {entry.path}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {files.some((entry) => entry.adapter === "github") ? (
                <optgroup label="GitHub Actions">
                  {files
                    .filter((entry) => entry.adapter === "github")
                    .map((entry) => (
                      <option key={entry.path} value={entry.path}>
                        {entry.path.slice(entry.path.lastIndexOf("/") + 1)}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
          ) : (
            <span className="truncate font-mono text-xs text-text-muted">{state.file}</span>
          )}
          {/* The only on-screen consumer of `pipeline.files`. Without it, the field was computed,
              tested and invisible — which `CLAUDE.md` forbids. It tells the user that what they
              read comes from several files, which neither the graph nor the header path says. */}
          {includedCount === 0 ? null : (
            <span
              data-testid="included-files-tag"
              title={`Resolved includes: ${resolvedIncludes.join(", ")}`}
              className="shrink-0 rounded-sm border border-border-default px-1 text-2xs font-semibold tracking-label text-text-muted uppercase"
            >
              {includedCount === 1 ? "1 included file" : `${includedCount} included files`}
            </span>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {state.pending || toolchainState.pending ? (
            <span
              data-testid="pending-indicator"
              role="status"
              className="flex items-center gap-1.5 text-2xs font-semibold tracking-label text-text-muted uppercase"
            >
              <span aria-hidden="true" className="size-1.5 rounded-sm bg-accent" />
              Writing
            </span>
          ) : null}
          {showSidebar && state.view !== "catalog" ? (
            <button
              ref={panelTrigger}
              type="button"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`lg:hidden ${BUTTON}`}
            >
              {inToolchain && (toolchainPayload?.proposed.length ?? 0) > 0
                ? `Panel, ${toolchainPayload?.proposed.length} proposed`
                : "Panel"}
            </button>
          ) : null}
          {searchable ? (
            <button
              ref={searchTrigger}
              type="button"
              aria-expanded={searchOpen}
              aria-keyshortcuts="Control+K Meta+K /"
              title="Find job (Ctrl+K or /)"
              onClick={() => setSearchOpen(true)}
              className={BUTTON}
            >
              Find job
            </button>
          ) : null}
          <nav aria-label="Views" className="flex items-center gap-1">
            {VIEWS.map(({ view, label }) => (
              <button
                key={view}
                type="button"
                aria-current={state.view === view ? "page" : undefined}
                onClick={() => {
                  setSidebarOpen(false);
                  store.getState().setView(view);
                }}
                className={`${BUTTON} aria-[current=page]:border-accent aria-[current=page]:bg-surface-3 aria-[current=page]:font-semibold aria-[current=page]:text-text-primary`}
              >
                {label}
              </button>
            ))}
          </nav>
          {state.view === "pipeline" ? (
            <HistoryControls
              canUndo={editable && state.canUndo()}
              canRedo={editable && state.canRedo()}
              onUndo={() => void store.getState().undo()}
              onRedo={() => void store.getState().redo()}
            />
          ) : null}
          {inToolchain ? (
            <HistoryControls
              canUndo={toolchainEditable && toolchainState.canUndo()}
              canRedo={toolchainEditable && toolchainState.canRedo()}
              onUndo={() => void toolchainStore.getState().undo()}
              onRedo={() => void toolchainStore.getState().redo()}
            />
          ) : null}
        </span>
      </header>

      {searchOpen && searchable && state.pipeline !== null ? (
        <JobSearch
          jobs={state.pipeline.jobs}
          onClose={() => {
            setSearchOpen(false);
            searchTrigger.current?.focus();
          }}
          onPick={(id) => {
            setSearchOpen(false);
            store.getState().selectJob(id);
            if (!overlaysCover()) {
              focusWhenDrawn(`[data-job-id="${CSS.escape(id)}"]`);
            }
          }}
        />
      ) : null}

      {state.pipeline === null ? null : <PartialPipelineBar pipeline={state.pipeline} />}

      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {showSidebar && state.pipeline !== null && state.view !== "catalog" ? (
          <aside
            ref={sidebar.ref}
            onKeyDown={sidebar.onKeyDown}
            aria-label={readingCoverage ? "Coverage" : inToolchain ? "Toolchain" : "Edit pipeline"}
            className={`flex w-[var(--keelson-panel-width)] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-surface-1 p-3 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:w-full ${sidebarOpen ? "" : "max-lg:hidden"}`}
          >
            <button type="button" onClick={closeSidebar} className={`self-end lg:hidden ${BUTTON}`}>
              Close panel
            </button>
            {inToolchain ? (
              toolchainPayload === null ? null : (
                <ToolchainPanel
                  payload={toolchainPayload}
                  tools={state.catalog?.tools ?? []}
                  disabled={!toolchainEditable}
                  invalid={toolchainInvalid}
                  selectedService={toolchainState.selectedService}
                  onSubmit={async (draft) => {
                    let written: unknown;
                    await keepFocusThrough(sidebar.ref.current, async () => {
                      written = await toolchainStore.getState().submit(draft);
                    });
                    return written;
                  }}
                  onSelectService={(id) => {
                    setSidebarOpen(false);
                    toolchainStore.getState().selectService(id);
                  }}
                />
              )
            ) : readingCoverage && state.coverage !== null ? (
              <CoveragePanel
                coverage={shownCoverage ?? state.coverage}
                cause={lowerBoundCause(state.pipeline, state.diagnostics)}
                scope={
                  severalFiles
                    ? {
                        file: state.file ?? "",
                        count: files.length,
                        whole: wholeRepository && repositoryCoverage !== null,
                        onChange: setWholeRepository,
                      }
                    : null
                }
                selected={state.selectedLayer}
                onSelect={(layer) => store.getState().selectLayer(layer)}
                onShowTools={(layer) => {
                  setSidebarOpen(false);
                  store.getState().showTools(layer);
                  focusWhenDrawn('[aria-label="Tool catalogue"] select');
                }}
              />
            ) : (
              <>
                {state.pipeline.provider === "github" ? null : (
                  <Section title="Stages">
                    <StageControls
                      pipeline={state.pipeline}
                      onSubmit={(draft) => void store.getState().submit(draft)}
                      disabled={!editable}
                    />
                  </Section>
                )}
                <Section title="New job">
                  <NewJobForm
                    key={state.file}
                    pipeline={state.pipeline}
                    onSubmit={(draft) => void store.getState().submit(draft)}
                    disabled={!editable}
                  />
                </Section>
              </>
            )}
          </aside>
        ) : null}

        <main className="min-w-[var(--keelson-canvas-min-width)] flex-1">{body}</main>

        {selectedService === null || toolchainPayload === null ? null : (
          <aside
            ref={servicePanel.ref}
            onKeyDown={servicePanel.onKeyDown}
            aria-label="Service"
            className="w-[var(--keelson-panel-width)] shrink-0 overflow-y-auto max-lg:fixed max-lg:inset-0 max-lg:z-20 max-lg:w-full max-lg:bg-surface-1"
          >
            <ServicePanel
              key={`${selectedService.id}:${selectedService.url}:${selectedService.environment}`}
              service={selectedService}
              toolchain={toolchainPayload.toolchain}
              tool={state.catalog?.tools.find((tool) => tool.id === selectedService.tool)}
              jobs={state.pipeline?.jobs.map((job) => job.id) ?? []}
              disabled={!toolchainEditable}
              onSubmit={(draft) =>
                void keepFocusThrough(servicePanel.ref.current, () =>
                  toolchainStore.getState().submit(draft),
                )
              }
              onClose={() => toolchainStore.getState().selectService(null)}
            />
          </aside>
        )}

        {readingText === undefined || reading === null ? null : (
          <aside
            ref={filePanel.ref}
            onKeyDown={filePanel.onKeyDown}
            aria-label={`Included file ${reading}`}
            className="w-[var(--keelson-panel-width)] shrink-0 overflow-y-auto border-l border-border-subtle bg-surface-1 max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-full"
          >
            <IncludedFileView file={reading} text={readingText} onClose={closeFile} />
          </aside>
        )}

        {!jobPanelOpen || selected === null || state.pipeline === null ? null : (
          <aside
            ref={jobPanel.ref}
            onKeyDown={jobPanel.onKeyDown}
            aria-label="Job"
            className="w-[var(--keelson-panel-width)] shrink-0 overflow-y-auto max-lg:fixed max-lg:inset-0 max-lg:z-20 max-lg:w-full max-lg:bg-surface-1"
          >
            <JobDetailPanel
              job={selected}
              textOf={(file) => state.textOf(file)}
              main={state.pipeline.main}
              derivedStages={state.pipeline.provider === "github"}
              coverage={
                readingCoverage
                  ? (state.coverage?.jobs.find((entry) => entry.job === selected.id) ?? null)
                  : null
              }
              onReadFile={state.included[selected.file] === undefined ? undefined : readFile}
              onClose={() => store.getState().selectJob(null)}
            />
            {readingCoverage || selected.file !== state.pipeline.main ? null : (
              <div className="border-l border-border-subtle bg-surface-1 p-3">
                <JobEditor
                  key={selected.id}
                  job={selected}
                  pipeline={state.pipeline}
                  onSubmit={(draft) => void store.getState().submit(draft)}
                  disabled={!editable}
                />
              </div>
            )}
          </aside>
        )}
      </div>

      <div className="max-h-1/3 shrink-0 overflow-y-auto">
        <DiagnosticsPanel
          diagnostics={state.diagnostics}
          main={state.pipeline?.main ?? state.file ?? ""}
          omitInfo={state.pipeline !== null && isPartial(state.pipeline)}
          onSelectRange={(file, range) => store.getState().selectByRange(file, range)}
          readable={(file) => state.included[file] !== undefined}
          onReadFile={readFile}
        />
      </div>
    </div>
  );
}
