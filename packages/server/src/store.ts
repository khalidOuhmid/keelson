import {
  apply,
  createFileReader,
  type IncludeReader,
  parse,
  readInsideRoot,
} from "@keelson/adapter-gitlab";
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
import { parseOperation, TOOLCHAIN_FILE, validate } from "@keelson/core";
import { NOT_FOUND, STALE_DOCUMENT } from "@keelson/core/messages";
import { analyseToolchain, LAYOUT_FILE, parseLayout } from "@keelson/toolchain";
import { resolveWorkspaceFile, type WorkspaceFile } from "./workspace.ts";
import { writeAtomic } from "./write.ts";

export const OPID_HISTORY = 100;

type Analysis = { diagnostics: Diagnostic[]; coverage: Coverage };

/** Ce que l'écran sait d'un pipeline, calculé au même endroit au chargement et après une opération :
 *  la CLI fait le même calcul, et les deux doivent dire la même chose. */
function analyse(root: string, parsing: readonly Diagnostic[], pipeline: Pipeline): Analysis {
  const { tools } = loadCatalog();
  const layout = parseLayout(readInsideRoot(root, LAYOUT_FILE), pipeline);
  const toolchain = analyseToolchain(readInsideRoot(root, TOOLCHAIN_FILE), pipeline, tools);
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
  /** Le texte de chaque fichier inclus, tel qu'il a servi à cette analyse. Il part sur le fil avec
   *  le reste plutôt que par une route dédiée : les plages des blocs opaques d'un job inclus sont
   *  des offsets dans ces textes, et une route séparée les laisserait se désaligner entre deux
   *  requêtes — en plus d'ouvrir une seconde surface de lecture du disque à borner. */
  included: Record<string, string>;
  coverage: Coverage;
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
  included: Record<string, string>;
  coverage: Coverage;
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
  included: Record<string, string>;
  coverage: Coverage;
};

export class DocumentStore {
  private readonly loaded = new Map<string, Loaded>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly seen = new Map<string, Map<string, StoreResponse>>();

  /** Un lecteur par store, donc un seul parcours du dépôt pour les candidats d'un joker, quel que
   *  soit le nombre de requêtes. */
  private readonly reader: IncludeReader;

  /** Prévenus après chaque chargement réussi. Le watcher s'y abonne pour apprendre les fichiers
   *  inclus : sans cela il ne les connaîtrait qu'après un premier changement, donc le tout premier
   *  changement d'un fichier inclus serait toujours manqué. */
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

  async load(file: string): Promise<DocumentBody | null> {
    const absolute = this.absolute(file);
    if (absolute === null) {
      return null;
    }

    // Par le lecteur, comme les fichiers inclus : il tient seul la frontière de la racine, et un
    // `.gitlab-ci.yml` lié hors du dépôt ne doit pas être la voie qui la contourne.
    const text = this.reader.read(file);
    if (text === null) {
      this.loaded.delete(file);
      return null;
    }

    const parsed = parse(text, { file, read: this.reader });
    const { diagnostics, coverage: covered } = analyse(
      this.root,
      parsed.diagnostics,
      parsed.pipeline,
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

  /** Les fichiers inclus par un document, tels que la dernière analyse les a résolus. Le watcher
   *  s'en sert pour surveiller aussi leurs dossiers : sans cela, modifier un fichier inclus ne
   *  provoquait aucun événement et l'écran restait sur un pipeline périmé. */
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

  /** Le résultat d'une opération sans l'écrire ni la retenir : mêmes refus, mêmes hash. */
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

    // Le watcher a 40 ms de retard sur le disque : sans cette relecture, une écriture externe dans
    // cette fenêtre serait écrasée par une opération fondée sur le texte en cache.
    if (this.loaded.has(file) && this.reader.read(file) !== this.loaded.get(file)?.text) {
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

    const parsed = parse(current.text, { file, read: this.reader });
    const result = apply(parsed.document, validated.value);

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
        included: result.value.included,
        coverage: covered,
      },
    };
  }
}
