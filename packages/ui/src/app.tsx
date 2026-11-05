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
import {
  type ApiResult,
  type CatalogPayload,
  type DocumentPayload,
  KeelsonClient,
  type OperationPayload,
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
import { DiagnosticsPanel } from "./panels/DiagnosticsPanel.tsx";
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
import { PipelineCanvas } from "./views/pipeline/PipelineCanvas.tsx";
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
  eventsUrl: () => string;
};

export type AppDeps = {
  client: ClientSurface;
  subscribe?: typeof subscribeToEvents;
  newOpId?: () => string;
};

/** La mise en page du graphe est asynchrone : le nœud n'existe pas encore au prochain rendu. */
function focusWhenDrawn(selector: string, frames = 120): void {
  const found = document.querySelector<HTMLElement>(selector);
  if (found !== null) {
    found.focus();
  } else if (frames > 0) {
    requestAnimationFrame(() => focusWhenDrawn(selector, frames - 1));
  }
}

function browserDeps(): AppDeps {
  const token = readToken(browserLocation()) ?? "";
  return { client: new KeelsonClient({ token }) };
}

export type AppProps = {
  deps?: AppDeps;
};

/** Une section titrée, séparée de la suivante par un filet. `role="group"` plutôt que `<section>` :
 *  la barre latérale ne doit pas ajouter un repère de navigation par bloc de contrôles. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: un groupe de contrôles ne doit pas devenir un landmark ; fieldset est réservé aux formulaires
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
        newOpId: resolved.newOpId ?? (() => crypto.randomUUID()),
      }),
    [resolved],
  );
  const state = useStore(store);
  const toolchainState = useStore(toolchainStore);

  useEffect(() => {
    void toolchainStore.getState().load();
  }, [toolchainStore]);

  // Les propositions dépendent du pipeline : un job ajouté ou renommé les change.
  useEffect(() => {
    if (state.hash !== null) {
      void toolchainStore.getState().refresh();
    }
  }, [toolchainStore, state.hash]);
  const [root, setRoot] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [files, setFiles] = useState<readonly WorkspaceFile[]>([]);
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

      const first = workspace.value.files[0];
      if (first === undefined) {
        store.getState().workspaceEmpty();
        return;
      }

      setRoot(first.path);
      setFiles(workspace.value.files);
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
      if (event.kind === "toolchain.changed") {
        void toolchainStore.getState().changed(event.hash);
        return;
      }
      void store.getState().serverEvent(event);
      // `layout.json` a pu changer : les positions d'une autre main arrivent par ici.
      if (event.kind === "coverage.changed") {
        void toolchainStore.getState().refresh();
      }
    });
    return () => subscription.close();
  }, [resolved, store, toolchainStore]);

  // Quand le panneau de détail disparaît — Échap, bouton de fermeture ou suppression confirmée —
  // le focus revient au graphe plutôt que de retomber sur <body>.
  const hadSelection = useRef(false);
  useEffect(() => {
    const open = state.selectedJobId !== null;
    if (hadSelection.current && !open) {
      document.querySelector<HTMLElement>('[aria-label="Pipeline graph"]')?.focus();
    }
    hadSelection.current = open;
  }, [state.selectedJobId]);

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

  // Échap referme le panneau de détail. L'écouteur est au niveau du document : la sélection se
  // désigne au canevas mais se referme depuis n'importe où, panneau compris.
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        store.getState().selectJob(null);
        toolchainStore.getState().selectService(null);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [store, toolchainStore]);

  // Une opération en vol désactive l'édition : sans cela chaque contrôle reste actif et une
  // seconde soumission part sur un hash déjà périmé.
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

  const reading = state.view === "coverage";
  const overlay = useMemo(
    () =>
      reading
        ? {
            jobs: new Map(state.coverage?.jobs.map((job) => [job.job, job.layers]) ?? []),
            selected: state.selectedLayer,
          }
        : null,
    [reading, state.coverage, state.selectedLayer],
  );

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
              // Sous `lg`, sélectionner ouvrirait une superposition par-dessus Undo et le nœud.
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
    return (
      <PipelineCanvas
        pipeline={state.pipeline ?? emptyPipeline(state.file ?? "")}
        selectedJobId={state.selectedJobId}
        onSelectJob={(id) => store.getState().selectJob(id)}
        overlay={overlay}
      />
    );
  })();

  /** Les fichiers résolus autres que le principal. `files` peut contenir deux fois le même —
   *  GitLab ne dédoublonne pas les includes — mais le compte annoncé à l'écran est un compte de
   *  **fichiers**, pas d'entrées. */
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
        <span className="-m-1 flex items-baseline gap-2 overflow-hidden p-1">
          <span className="text-sm font-semibold text-text-primary">Keelson</span>
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
          {/* Le seul consommateur de `pipeline.files` à l'écran. Sans lui, le champ était calculé,
              testé et invisible — ce que `CLAUDE.md` interdit. Il dit à l'utilisateur que ce qu'il
              lit vient de plusieurs fichiers, ce que ni le graphe ni le chemin de l'en-tête ne
              disent. */}
          {includedCount === 0 ? null : (
            <span
              data-testid="included-files-tag"
              title={`Resolved includes: ${resolvedIncludes.join(", ")}`}
              className="shrink-0 rounded-sm border border-border-default px-1 text-2xs tracking-label text-text-muted uppercase"
            >
              {includedCount === 1 ? "1 included file" : `${includedCount} included files`}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {state.pending || toolchainState.pending ? (
            <span
              data-testid="pending-indicator"
              role="status"
              className="flex items-center gap-1.5 text-2xs tracking-label text-text-muted uppercase"
            >
              <span aria-hidden="true" className="size-1.5 rounded-sm bg-accent" />
              Writing
            </span>
          ) : null}
          {showSidebar && state.view !== "catalog" ? (
            <button
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
              canUndo={state.canUndo()}
              canRedo={state.canRedo()}
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

      {state.pipeline === null ? null : <PartialPipelineBar pipeline={state.pipeline} />}

      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {showSidebar && state.pipeline !== null && state.view !== "catalog" ? (
          <aside
            aria-label={reading ? "Coverage" : inToolchain ? "Toolchain" : "Edit pipeline"}
            className={`flex w-[var(--keelson-panel-width)] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-surface-1 p-3 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:w-full ${sidebarOpen ? "" : "max-lg:hidden"}`}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className={`self-end lg:hidden ${BUTTON}`}
            >
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
                  onSubmit={(draft) => toolchainStore.getState().submit(draft)}
                  onSelectService={(id) => {
                    setSidebarOpen(false);
                    toolchainStore.getState().selectService(id);
                  }}
                />
              )
            ) : reading && state.coverage !== null ? (
              <CoveragePanel
                coverage={state.coverage}
                scope={files.length > 1 ? { file: state.file ?? "", count: files.length } : null}
                selected={state.selectedLayer}
                onSelect={(layer) => store.getState().selectLayer(layer)}
                onShowTools={(layer) => {
                  setSidebarOpen(false);
                  store.getState().showTools(layer);
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
              onSubmit={(draft) => void toolchainStore.getState().submit(draft)}
              onClose={() => toolchainStore.getState().selectService(null)}
            />
          </aside>
        )}

        {selected === null ||
        state.pipeline === null ||
        state.view === "catalog" ||
        inToolchain ? null : (
          <aside className="w-[var(--keelson-panel-width)] shrink-0 overflow-y-auto max-lg:fixed max-lg:inset-0 max-lg:z-20 max-lg:w-full max-lg:bg-surface-1">
            <JobDetailPanel
              job={selected}
              textOf={(file) => state.textOf(file)}
              main={state.pipeline.main}
              derivedStages={state.pipeline.provider === "github"}
              coverage={
                reading
                  ? (state.coverage?.jobs.find((entry) => entry.job === selected.id) ?? null)
                  : null
              }
              onClose={() => store.getState().selectJob(null)}
            />
            {reading || selected.file !== state.pipeline.main ? null : (
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
        />
      </div>
    </div>
  );
}
