import { readFile } from "node:fs/promises";
import { apply, parse } from "@keelson/adapter-gitlab";
import type {
  Diagnostic,
  MessageCode,
  Operation,
  ParamsOf,
  Pipeline,
  SourceRange,
  SpliceOperation,
} from "@keelson/core";
import { parseOperation, validate } from "@keelson/core";
import { NOT_FOUND, STALE_DOCUMENT } from "@keelson/core/messages";
import { resolveWorkspaceFile, type WorkspaceFile } from "./workspace.ts";
import { writeAtomic } from "./write.ts";

export const OPID_HISTORY = 100;

function allDiagnostics(parsing: readonly Diagnostic[], pipeline: Pipeline): Diagnostic[] {
  return [...parsing, ...validate(pipeline)];
}

export type DocumentBody = {
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
};

export type OperationBody = {
  /** Le texte apres l'operation. Sans lui, le client garde celui du dernier chargement complet,
   *  alors que les plages des blocs opaques viennent du nouveau pipeline : les deux se desalignent
   *  des qu'une operation decale des offsets, et le watcher tait les ecritures propres du serveur,
   *  donc aucun rechargement ne les reconcilie. */
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  inverse: SpliceOperation;
  touched: SourceRange[];
};

/** Pas de `message` : le texte est rendu côté client par `@keelson/core/messages`. `hash` n'est
 *  présent que sur le 409, où le client en a besoin pour recalculer son opération. */
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
};

export class DocumentStore {
  private readonly loaded = new Map<string, Loaded>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly seen = new Map<string, Map<string, StoreResponse>>();

  constructor(
    private readonly root: string,
    private files: readonly WorkspaceFile[],
  ) {}

  workspaceFiles(): readonly WorkspaceFile[] {
    return this.files;
  }

  setFiles(files: readonly WorkspaceFile[]): void {
    this.files = files;
  }

  private absolute(file: string): string | null {
    return resolveWorkspaceFile(this.root, this.files, file);
  }

  async load(file: string): Promise<DocumentBody | null> {
    const absolute = this.absolute(file);
    if (absolute === null) {
      return null;
    }

    let text: string;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      this.loaded.delete(file);
      return null;
    }

    const parsed = parse(text);
    const diagnostics = allDiagnostics(parsed.diagnostics, parsed.pipeline);
    this.loaded.set(file, {
      absolute,
      text,
      pipeline: parsed.pipeline,
      diagnostics,
      hash: parsed.hash,
    });

    return { text, pipeline: parsed.pipeline, diagnostics, hash: parsed.hash };
  }

  currentHash(file: string): string | undefined {
    return this.loaded.get(file)?.hash;
  }

  currentText(file: string): string | undefined {
    return this.loaded.get(file)?.text;
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

  private async executeOperation(file: string, operation: Operation): Promise<StoreResponse> {
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

    const current =
      this.loaded.get(file) ?? (await this.load(file).then(() => this.loaded.get(file)));
    if (current === undefined) {
      return {
        status: 404,
        body: { code: NOT_FOUND, params: { reason: "missingFile", file } },
      };
    }

    const parsed = parse(current.text);
    const result = apply(parsed.document, validated.value);

    if (!result.ok) {
      const stale = result.error.code === STALE_DOCUMENT;
      return {
        status: stale ? 409 : 422,
        body: stale ? { ...result.error, hash: current.hash } : result.error,
      };
    }

    await writeAtomic(current.absolute, result.value.text);

    const diagnostics = allDiagnostics(result.value.diagnostics, result.value.pipeline);

    this.loaded.set(file, {
      absolute: current.absolute,
      text: result.value.text,
      pipeline: result.value.pipeline,
      diagnostics,
      // `apply` rend `parse(texte).hash`, donc le hash du texte qu'il vient d'écrire. Le recalculer
      // ici donnait deux expressions pour une seule vérité : si elles divergeaient, le cache
      // répondrait 409 contre un hash que le client n'a jamais reçu.
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
      },
    };
  }
}
