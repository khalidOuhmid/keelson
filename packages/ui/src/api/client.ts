import type { Catalog, Coverage } from "@keelson/catalog";
import type {
  Diagnostic,
  MessageCode,
  Operation,
  ParamsOf,
  Pipeline,
  SourceRange,
  SpliceOperation,
} from "@keelson/core";
import { MESSAGE_CODES, NETWORK_ERROR, UNEXPECTED_RESPONSE } from "@keelson/core/messages";
import type { Layer } from "@keelson/taxonomy";

export type AdapterName = "gitlab";

export type WorkspaceFile = {
  path: string;
  adapter: AdapterName;
};

export type DocumentPayload = {
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  /** Le texte de chaque fichier inclus. Les plages des blocs opaques d'un job inclus sont des
   *  offsets dedans : les découper dans le texte du fichier principal afficherait des octets pris
   *  ailleurs, sous la seule promesse du produit qui dit « ceci est verbatim ». */
  included: Record<string, string>;
  coverage: Coverage;
};

export type OperationPayload = {
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  inverse: SpliceOperation;
  touched: SourceRange[];
  included: Record<string, string>;
  coverage: Coverage;
};

export type CatalogPayload = Catalog & { layers: readonly Layer[] };

/** Pas de `message` : il n'est plus sur le fil. Le texte se rend par `renderMessage(failure)`,
 *  que cette forme rend directement possible. */
export type ApiFailure = {
  [C in MessageCode]: { status: number; code: C; params: ParamsOf<C>; hash?: string };
}[MessageCode];

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

export type ClientOptions = {
  baseUrl?: string;
  token: string;
  fetch?: typeof globalThis.fetch;
};

const TOKEN_HEADER = "X-Keelson-Token";

const KNOWN_CODES = new Set<string>(MESSAGE_CODES);

/** La seule frontière du produit où un `code` arrive sans type : il vient du réseau. Un code
 *  inconnu du registre devient `UNEXPECTED_RESPONSE` plutôt que de traverser l'UI pour finir en
 *  message vide — un `render()` sur un code absent lèverait, et le ferait au moment de l'affichage
 *  d'une erreur, c'est-à-dire au pire moment. */
function failure(status: number, body: unknown): ApiFailure {
  const shape = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof shape.code === "string" && KNOWN_CODES.has(shape.code) ? shape.code : null;

  if (code === null) {
    return { status, code: UNEXPECTED_RESPONSE, params: {} };
  }

  return {
    status,
    code,
    params: typeof shape.params === "object" && shape.params !== null ? shape.params : {},
    ...(typeof shape.hash === "string" ? { hash: shape.hash } : {}),
  } as ApiFailure;
}

export class KeelsonClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly request: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.token = options.token;
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  eventsUrl(): string {
    return `${this.baseUrl}/api/events?token=${encodeURIComponent(this.token)}`;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          [TOKEN_HEADER]: this.token,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          status: 0,
          code: NETWORK_ERROR,
          params: { detail: error instanceof Error ? error.message : "unknown cause" },
        },
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      return { ok: false, error: failure(response.status, body) };
    }

    return { ok: true, value: body as T };
  }

  workspace(): Promise<ApiResult<{ files: WorkspaceFile[] }>> {
    return this.call("/api/workspace");
  }

  document(file: string): Promise<ApiResult<DocumentPayload>> {
    return this.call(`/api/documents/${encodeURIComponent(file)}`);
  }

  catalog(): Promise<ApiResult<CatalogPayload>> {
    return this.call("/api/catalog");
  }

  submit(file: string, op: Operation, opId: string): Promise<ApiResult<OperationPayload>> {
    return this.call(`/api/documents/${encodeURIComponent(file)}/operations`, {
      method: "POST",
      body: JSON.stringify({ op, opId }),
    });
  }
}
