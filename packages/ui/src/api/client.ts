import type { Diagnostic, Operation, Pipeline, SourceRange, SpliceOperation } from "@keelson/core";

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
};

export type OperationPayload = {
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  inverse: SpliceOperation;
  touched: SourceRange[];
};

export type ApiFailure = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  hash?: string;
};

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

export type ClientOptions = {
  baseUrl?: string;
  token: string;
  fetch?: typeof globalThis.fetch;
};

const TOKEN_HEADER = "X-Keelson-Token";

function failure(status: number, body: unknown): ApiFailure {
  const shape = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    status,
    code: typeof shape.code === "string" ? shape.code : "UNKNOWN",
    message: typeof shape.message === "string" ? shape.message : "unexpected server response",
    ...(shape.details === undefined ? {} : { details: shape.details }),
    ...(typeof shape.hash === "string" ? { hash: shape.hash } : {}),
  };
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
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "network error",
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

  submit(file: string, op: Operation, opId: string): Promise<ApiResult<OperationPayload>> {
    return this.call(`/api/documents/${encodeURIComponent(file)}/operations`, {
      method: "POST",
      body: JSON.stringify({ op, opId }),
    });
  }
}
