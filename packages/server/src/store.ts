import { createFileReader, type IncludeReader, readInsideRoot } from "@keelson/adapter-gitlab";
import { type Coverage, coverage, loadCatalog } from "@keelson/catalog";
import type {
  Diagnostic,
  MessageCode,
  Operation,
  ParamsOf,
  Pipeline,
  SourceRange,
  SpliceOperation,
} from "@keelson/core";
import { mergePipelines, parseOperation, TOOLCHAIN_FILE, validate } from "@keelson/core";
import { NOT_FOUND, STALE_DOCUMENT } from "@keelson/core/messages";
import { analyseToolchain, LAYOUT_FILE, parseLayout } from "@keelson/toolchain";
import { adapterFor } from "./adapters.ts";
import { resolveWorkspaceFile, type WorkspaceFile } from "./workspace.ts";
import { writeAtomic } from "./write.ts";

export const OPID_HISTORY = 100;

type Analysis = { diagnostics: Diagnostic[]; coverage: Coverage };

/** What the screen knows about a pipeline, computed in one place on load and after an operation:
 *  the CLI does the same computation, and both must say the same thing. */
function analyse(
  root: string,
  parsing: readonly Diagnostic[],
  pipeline: Pipeline,
  repository: Pipeline,
): Analysis {
  const { tools } = loadCatalog();
  // `layout.json` and the toolchain are repository-wide: a job from another workflow is not unknown there.
  const layout = parseLayout(readInsideRoot(root, LAYOUT_FILE), repository);
  const toolchain = analyseToolchain(readInsideRoot(root, TOOLCHAIN_FILE), repository, tools);
  return {
    diagnostics: [
      ...parsing,
      ...validate(pipeline),
      ...layout.diagnostics,
      ...toolchain.diagnostics,
    ],
    coverage: coverage(pipeline, tools, layout.overrides, parsing, toolchain.toolchain.services),
  };
}

export type DocumentBody = {
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  /** The text of each included file, as it served this analysis. It goes over the wire with the
   *  rest rather than through a dedicated route: the ranges of an included job's opaque blocks are
   *  offsets into these texts, and a separate route would let them drift apart between two
   *  requests — on top of opening a second disk-read surface to bound. */
  included: Record<string, string>;
  coverage: Coverage;
};

export type OperationBody = {
  /** The text after the operation. Without it, the client keeps the one from the last full load,
   *  while the opaque block ranges come from the new pipeline: the two drift apart as soon as an
   *  operation shifts offsets, and the watcher stays silent on the server's own writes, so no
   *  reload reconciles them. */
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  inverse: SpliceOperation;
  touched: SourceRange[];
  included: Record<string, string>;
  coverage: Coverage;
};

/** No `message`: the text is rendered client-side by `@keelson/core/messages`. `hash` is only
 *  present on the 409, where the client needs it to recompute its operation. */
export type ErrorBody = {
  [C in MessageCode]: { code: C; params: ParamsOf<C>; hash?: string };
}[MessageCode];

export type StoreResponse = {
  status: 200 | 400 | 404 | 409 | 422;
  body: OperationBody | ErrorBody;
};

type Loaded = {
  absolute: string;
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  included: Record<string, string>;
  coverage: Coverage;
};

export class DocumentStore {
  private readonly loaded = new Map<string, Loaded>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly seen = new Map<string, Map<string, StoreResponse>>();
  private readonly neighbours = new Map<string, { text: string; pipeline: Pipeline }>();

  /** One reader per store, hence a single walk of the repository for a glob's candidates, however
   *  many requests there are. */
  private readonly reader: IncludeReader;

  /** Notified after each successful load. The watcher subscribes to learn the included files:
   *  otherwise it would only know them after a first change, so the very first change to an
   *  included file would always be missed. */
  private readonly loadedListeners = new Set<() => void>();

  constructor(
    private readonly root: string,
    private files: readonly WorkspaceFile[],
  ) {
    this.reader = createFileReader(root);
  }

  workspaceFiles(): readonly WorkspaceFile[] {
    return this.files;
  }

  setFiles(files: readonly WorkspaceFile[]): void {
    this.files = files;
  }

  private absolute(file: string): string | null {
    return resolveWorkspaceFile(this.root, this.files, file);
  }

  /** This pipeline, plus those of the workspace's other files as they are on disk. A neighbour the
   *  parser cannot read must not prevent opening this file. Per text: re-reading it for each
   *  document would make opening the repository quadratic. */
  private repository(file: string, pipeline: Pipeline): Pipeline {
    const others = this.files
      .filter((entry) => entry.path !== file)
      .flatMap((entry) => {
        const text = this.reader.read(entry.path);
        if (text === null) {
          return [];
        }
        const known = this.neighbours.get(entry.path);
        if (known?.text === text) {
          return [known.pipeline];
        }
        try {
          const read = adapterFor(entry.path).parse(text, { file: entry.path, read: this.reader });
          // A workflow depends only on its text; a GitLab file also depends on its includes.
          if (read.pipeline.provider === "github") {
            this.neighbours.set(entry.path, { text, pipeline: read.pipeline });
          }
          return [read.pipeline];
        } catch {
          return [];
        }
      });
    return mergePipelines([pipeline, ...others]);
  }

  async load(file: string): Promise<DocumentBody | null> {
    const absolute = this.absolute(file);
    if (absolute === null) {
      return null;
    }

    // Through the reader, like included files: it alone holds the root boundary, and a
    // `.gitlab-ci.yml` linked outside the repository must not be the way around it.
    const text = this.reader.read(file);
    if (text === null) {
      this.loaded.delete(file);
      return null;
    }

    const parsed = adapterFor(file).parse(text, { file, read: this.reader });
    const { diagnostics, coverage: covered } = analyse(
      this.root,
      parsed.diagnostics,
      parsed.pipeline,
      this.repository(file, parsed.pipeline),
    );
    this.loaded.set(file, {
      absolute,
      text,
      pipeline: parsed.pipeline,
      diagnostics,
      hash: parsed.hash,
      included: parsed.included,
      coverage: covered,
    });

    for (const listener of this.loadedListeners) {
      listener();
    }

    return {
      text,
      pipeline: parsed.pipeline,
      diagnostics,
      hash: parsed.hash,
      included: parsed.included,
      coverage: covered,
    };
  }

  onLoaded(listener: () => void): () => void {
    this.loadedListeners.add(listener);
    return () => {
      this.loadedListeners.delete(listener);
    };
  }

  currentHash(file: string): string | undefined {
    return this.loaded.get(file)?.hash;
  }

  currentPipeline(file: string): Pipeline | undefined {
    return this.loaded.get(file)?.pipeline;
  }

  currentText(file: string): string | undefined {
    return this.loaded.get(file)?.text;
  }

  /** The files a document includes, as the last analysis resolved them. The watcher uses them to
   *  watch their directories too: without this, editing an included file triggered no event and
   *  the screen stayed on a stale pipeline. */
  includedFiles(file: string): readonly string[] {
    return Object.keys(this.loaded.get(file)?.included ?? {});
  }

  forget(file: string): void {
    this.loaded.delete(file);
  }

  rememberedOpIds(file: string): string[] {
    return [...(this.seen.get(file)?.keys() ?? [])];
  }

  private remember(file: string, opId: string, response: StoreResponse): void {
    const history = this.seen.get(file) ?? new Map<string, StoreResponse>();
    history.set(opId, response);
    while (history.size > OPID_HISTORY) {
      const oldest = history.keys().next();
      if (oldest.done === true) {
        break;
      }
      history.delete(oldest.value);
    }
    this.seen.set(file, history);
  }

  applyOperation(file: string, operation: Operation, opId: string): Promise<StoreResponse> {
    const previous = this.queues.get(file) ?? Promise.resolve();
    const next = previous.then(
      () => this.runOperation(file, operation, opId),
      () => this.runOperation(file, operation, opId),
    );
    this.queues.set(
      file,
      next.catch(() => undefined),
    );
    return next;
  }

  private async runOperation(
    file: string,
    operation: Operation,
    opId: string,
  ): Promise<StoreResponse> {
    const replay = this.seen.get(file)?.get(opId);
    if (replay !== undefined) {
      return replay;
    }

    const response = await this.executeOperation(file, operation);
    this.remember(file, opId, response);
    return response;
  }

  /** The result of an operation without writing or keeping it: same refusals, same hashes. */
  preview(file: string, operation: Operation): Promise<StoreResponse> {
    return this.executeOperation(file, operation, false);
  }

  private async executeOperation(
    file: string,
    operation: Operation,
    write = true,
  ): Promise<StoreResponse> {
    if (this.absolute(file) === null) {
      return {
        status: 404,
        body: { code: NOT_FOUND, params: { reason: "unknownFile", file } },
      };
    }

    const validated = parseOperation(operation);
    if (!validated.ok) {
      return { status: 400, body: validated.error };
    }

    // The watcher lags the disk by 40 ms: without this re-read, an external write in that
    // window would be overwritten by an operation based on the cached text.
    const known = this.loaded.get(file);
    const onDisk = known === undefined ? undefined : this.reader.read(file);
    if (known !== undefined && onDisk !== known.text) {
      // A preview has nothing to change: loading would advance the hash, and the watcher would
      // no longer report the change on screen.
      if (!write && (onDisk === null || onDisk === undefined)) {
        return { status: 404, body: { code: NOT_FOUND, params: { reason: "missingFile", file } } };
      }
      if (!write) {
        const { hash } = adapterFor(file).parse(onDisk as string, { file, read: this.reader });
        return {
          status: 409,
          body: {
            code: STALE_DOCUMENT,
            params: { expected: hash, received: validated.value.baseHash },
            hash,
          },
        };
      }
      await this.load(file);
    }
    const current =
      this.loaded.get(file) ?? (await this.load(file).then(() => this.loaded.get(file)));
    if (current === undefined) {
      return {
        status: 404,
        body: { code: NOT_FOUND, params: { reason: "missingFile", file } },
      };
    }

    const adapter = adapterFor(file);
    const parsed = adapter.parse(current.text, { file, read: this.reader });
    const result = adapter.apply(parsed, validated.value);

    if (!result.ok) {
      const stale = result.error.code === STALE_DOCUMENT;
      return {
        status: stale ? 409 : 422,
        body: stale ? { ...result.error, hash: current.hash } : result.error,
      };
    }

    const { diagnostics, coverage: covered } = analyse(
      this.root,
      result.value.diagnostics,
      result.value.pipeline,
      this.repository(file, result.value.pipeline),
    );

    if (!write) {
      return {
        status: 200,
        body: {
          text: result.value.text,
          pipeline: result.value.pipeline,
          diagnostics,
          hash: result.value.hash,
          inverse: result.value.inverse,
          touched: result.value.touched,
          included: result.value.included,
          coverage: covered,
        },
      };
    }

    await writeAtomic(current.absolute, result.value.text);

    this.loaded.set(file, {
      absolute: current.absolute,
      text: result.value.text,
      pipeline: result.value.pipeline,
      included: result.value.included,
      coverage: covered,
      diagnostics,
      // `apply` returns `parse(text).hash`, hence the hash of the text it just wrote. Recomputing it
      // here gave two expressions for a single truth: if they diverged, the cache would answer 409
      // against a hash the client never received.
      hash: result.value.hash,
    });

    return {
      status: 200,
      body: {
        text: result.value.text,
        pipeline: result.value.pipeline,
        diagnostics,
        hash: result.value.hash,
        inverse: result.value.inverse,
        touched: result.value.touched,
        included: result.value.included,
        coverage: covered,
      },
    };
  }
}
