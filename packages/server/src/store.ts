import { readFile, realpath } from "node:fs/promises";
import { sep } from "node:path";
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
import { INVALID_OPERATION, NOT_FOUND, STALE_DOCUMENT } from "@keelson/core/messages";
import { analyseToolchain, LAYOUT_FILE, parseLayout } from "@keelson/toolchain";
import { adapterFor } from "./adapters.ts";
import { withFileLock } from "./lock.ts";
import { resolveWorkspaceFile, type WorkspaceFile } from "./workspace.ts";
import { writeAtomic } from "./write.ts";

export const OPID_HISTORY = 100;

type Analysis = { diagnostics: Diagnostic[]; coverage: Coverage };

/** The jobs of the whole workspace, and what parsing its files said: a file that did not parse
 *  leaves its jobs out of it. */
type Repository = { pipeline: Pipeline; parsing: readonly Diagnostic[] };

/** What the screen knows about a pipeline, computed in one place on load and after an operation:
 *  the CLI does the same computation, and both must say the same thing. */
function analyse(
  root: string,
  parsing: readonly Diagnostic[],
  pipeline: Pipeline,
  repository: Repository,
): Analysis {
  const { tools } = loadCatalog();
  // `layout.json` and the toolchain are repository-wide: a job from another workflow is not unknown there.
  const everyParsing = [...parsing, ...repository.parsing];
  const layout = parseLayout(readInsideRoot(root, LAYOUT_FILE), repository.pipeline, everyParsing);
  const toolchain = analyseToolchain(
    readInsideRoot(root, TOOLCHAIN_FILE),
    repository.pipeline,
    tools,
    everyParsing,
  );
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

export type WrittenEvent = { file: string; hash: string; opId: string };

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Where a write must go: the target of an internal link, never the link itself, which a `rename`
 *  would replace with a regular file. `null` if the target leaves the root. */
async function writeTarget(root: string, absolute: string): Promise<string | null> {
  const realRoot = await realpath(root);
  const target = await realpath(absolute).catch(() => absolute);
  return target.startsWith(`${realRoot}${sep}`) ? target : null;
}

/** The decoder replaces invalid bytes: writing the decoded text back would change bytes outside
 *  the touched range. */
async function isUtf8(path: string): Promise<boolean> {
  try {
    STRICT_UTF8.decode(await readFile(path));
    return true;
  } catch {
    return false;
  }
}

type Loaded = {
  absolute: string;
  text: string;
  pipeline: Pipeline;
  parsing: Diagnostic[];
  diagnostics: Diagnostic[];
  hash: string;
  included: Record<string, string>;
  coverage: Coverage;
};

export class DocumentStore {
  private readonly loaded = new Map<string, Loaded>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly seen = new Map<string, Map<string, StoreResponse>>();
  private readonly neighbours = new Map<
    string,
    { text: string; pipeline: Pipeline; parsing: Diagnostic[] }
  >();

  /** One reader per store, hence a single walk of the repository for a glob's candidates, however
   *  many requests there are. */
  private readonly reader: IncludeReader;

  /** Notified after each successful load. The watcher subscribes to learn the included files:
   *  otherwise it would only know them after a first change, so the very first change to an
   *  included file would always be missed. */
  private readonly loadedListeners = new Set<() => void>();

  private readonly writtenListeners = new Set<(event: WrittenEvent) => void>();

  constructor(
    private readonly root: string,
    private files: readonly WorkspaceFile[],
    private readonly write: (path: string, text: string) => Promise<void> = writeAtomic,
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
  private repository(file: string, pipeline: Pipeline): Repository {
    const others = this.files
      .filter((entry) => entry.path !== file)
      .flatMap((entry) => this.parsedOnDisk(entry.path));
    return {
      pipeline: mergePipelines([pipeline, ...others.map((other) => other.pipeline)]),
      parsing: others.flatMap((other) => other.parsing),
    };
  }

  private parsedOnDisk(
    path: string,
  ): { text: string; pipeline: Pipeline; parsing: Diagnostic[] }[] {
    const text = this.reader.read(path);
    if (text === null) {
      return [];
    }
    const known = this.neighbours.get(path);
    if (known?.text === text) {
      return [known];
    }
    try {
      const read = adapterFor(path).parse(text, { file: path, read: this.reader });
      // A workflow depends only on its text; a GitLab file also depends on its includes.
      const neighbour = { text, pipeline: read.pipeline, parsing: read.diagnostics };
      if (read.pipeline.provider === "github") {
        this.neighbours.set(path, neighbour);
      }
      return [neighbour];
    } catch {
      return [];
    }
  }

  /** Every CI file of the workspace together, as `keelson coverage` without arguments sees them. */
  repositoryCoverage(): { files: string[]; coverage: Coverage } {
    // DEBT(2026-11-12): a file the parser throws on or cannot read is left out without making the coverage partial — the CLI stops on it instead; gap 44 removes the throws.
    const parsed = this.files.flatMap((entry) => this.parsedOnDisk(entry.path));
    const pipeline = mergePipelines(parsed.map((entry) => entry.pipeline));
    const parsing = parsed.flatMap((entry) => entry.parsing);
    const { tools } = loadCatalog();
    const layout = parseLayout(readInsideRoot(this.root, LAYOUT_FILE), pipeline);
    const toolchain = analyseToolchain(
      readInsideRoot(this.root, TOOLCHAIN_FILE),
      pipeline,
      tools,
      parsing,
    );
    return {
      files: this.files.map((entry) => entry.path),
      coverage: coverage(pipeline, tools, layout.overrides, parsing, toolchain.toolchain.services),
    };
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
      parsing: parsed.diagnostics,
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

  /** Notified after each write of an operation, so that the other tabs learn about it: the watcher
   *  stays silent on the server's own writes. */
  onWritten(listener: (event: WrittenEvent) => void): () => void {
    this.writtenListeners.add(listener);
    return () => {
      this.writtenListeners.delete(listener);
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

  currentParsing(file: string): readonly Diagnostic[] | undefined {
    return this.loaded.get(file)?.parsing;
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
    if (response.status === 200 && "hash" in response.body) {
      for (const listener of this.writtenListeners) {
        listener({ file, hash: response.body.hash, opId });
      }
    }
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
    const absolute = this.absolute(file);
    if (absolute === null) {
      return {
        status: 404,
        body: { code: NOT_FOUND, params: { reason: "unknownFile", file } },
      };
    }
    return write
      ? withFileLock(this.root, absolute, () => this.compute(file, operation, true))
      : this.compute(file, operation, false);
  }

  private async compute(
    file: string,
    operation: Operation,
    write: boolean,
  ): Promise<StoreResponse> {
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

    const target = await writeTarget(this.root, current.absolute);
    if (target === null) {
      return {
        status: 422,
        body: { code: INVALID_OPERATION, params: { reason: "outsideRoot", path: file } },
      };
    }
    if (!(await isUtf8(target))) {
      return {
        status: 422,
        body: { code: INVALID_OPERATION, params: { reason: "notUtf8", file } },
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

    // Recorded before the rename: the watcher may see the new text before this write returns, and
    // must recognise it as the server's own.
    this.loaded.set(file, {
      absolute: current.absolute,
      text: result.value.text,
      pipeline: result.value.pipeline,
      parsing: result.value.diagnostics,
      included: result.value.included,
      coverage: covered,
      diagnostics,
      // `apply` returns `parse(text).hash`, hence the hash of the text it just wrote. Recomputing it
      // here gave two expressions for a single truth: if they diverged, the cache would answer 409
      // against a hash the client never received.
      hash: result.value.hash,
    });
    try {
      await this.write(target, result.value.text);
    } catch (error) {
      this.loaded.set(file, current);
      throw error;
    }

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
