import { type Catalog, type Coverage, coverageSchema } from "@keelson/catalog";
import {
  type Diagnostic,
  diagnosticSchema,
  type MessageCode,
  type Operation,
  type ParamsOf,
  type Pipeline,
  paramsFit,
  pipelineSchema,
  type SourceRange,
  type SpliceOperation,
  sourceRangeSchema,
  spliceSchema,
  type Toolchain,
  type ToolchainOperation,
} from "@keelson/core";
import { MESSAGE_CODES, NETWORK_ERROR, UNEXPECTED_RESPONSE } from "@keelson/core/messages";
import type { Layer } from "@keelson/taxonomy";
import type { Positions, ProposedIntegration } from "@keelson/toolchain";

export type AdapterName = "gitlab" | "github";

export type WorkspaceFile = {
  path: string;
  adapter: AdapterName;
};

export type DocumentPayload = {
  text: string;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
  /** The text of each included file. The opaque-block ranges of an included job are offsets into
   *  it: slicing them out of the main file's text would display bytes taken from elsewhere, under
   *  the one promise of the product that says "this is verbatim". */
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

/** Every CI file of the workspace together, as `keelson coverage` without arguments. */
export type RepositoryCoveragePayload = { files: string[]; coverage: Coverage };

export type CatalogPayload = Catalog & { layers: readonly Layer[] };

export type ToolchainPayload = {
  text: string;
  hash: string;
  toolchain: Toolchain;
  diagnostics: Diagnostic[];
  proposed: ProposedIntegration[];
  positions: Positions;
};

export type ToolchainOperationPayload = ToolchainPayload & { inverse: SpliceOperation };

/** No `message`: it is no longer on the wire. The text is rendered by `renderMessage(failure)`,
 *  which this shape makes directly possible. */
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

/** The only boundary of the product where a `code` arrives untyped: it comes from the network. A
 *  code unknown to the registry becomes `UNEXPECTED_RESPONSE` rather than crossing the UI to end up
 *  as an empty message — a `render()` on a missing code would throw, and would do so while an error
 *  is being displayed, that is, at the worst possible moment. */
function failure(status: number, body: unknown): ApiFailure {
  const shape = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof shape.code === "string" && KNOWN_CODES.has(shape.code) ? shape.code : null;

  const params = shape.params ?? {};
  if (code === null || !paramsFit(code as MessageCode, params)) {
    return { status, code: UNEXPECTED_RESPONSE, params: {} };
  }

  return {
    status,
    code,
    params,
    ...(typeof shape.hash === "string" ? { hash: shape.hash } : {}),
  } as ApiFailure;
}

type Validate<T> = (body: unknown) => T | null;

function fields(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function texts(value: unknown): Record<string, string> | null {
  const entries = fields(value);
  return entries !== null && Object.values(entries).every((entry) => typeof entry === "string")
    ? (entries as Record<string, string>)
    : null;
}

const diagnosticList = diagnosticSchema.array();
const rangeList = sourceRangeSchema.array();

const documentPayload: Validate<DocumentPayload> = (body) => {
  const shape = fields(body);
  if (shape === null || typeof shape.text !== "string" || typeof shape.hash !== "string") {
    return null;
  }
  const pipeline = pipelineSchema.safeParse(shape.pipeline);
  const diagnostics = diagnosticList.safeParse(shape.diagnostics);
  const coverage = coverageSchema.safeParse(shape.coverage);
  const included = texts(shape.included);
  if (!pipeline.success || !diagnostics.success || !coverage.success || included === null) {
    return null;
  }
  return {
    text: shape.text,
    hash: shape.hash,
    pipeline: pipeline.data,
    diagnostics: diagnostics.data,
    coverage: coverage.data,
    included,
  };
};

const operationPayload: Validate<OperationPayload> = (body) => {
  const document = documentPayload(body);
  const shape = fields(body);
  const inverse = spliceSchema.safeParse(shape?.inverse);
  const touched = rangeList.safeParse(shape?.touched);
  if (document === null || !inverse.success || !touched.success) {
    return null;
  }
  return { ...document, inverse: inverse.data, touched: touched.data };
};

const workspacePayload: Validate<{ files: WorkspaceFile[] }> = (body) => {
  const files = fields(body)?.files;
  const valid =
    Array.isArray(files) &&
    files.every(
      (entry) =>
        typeof fields(entry)?.path === "string" &&
        (fields(entry)?.adapter === "gitlab" || fields(entry)?.adapter === "github"),
    );
  return valid ? { files: files as WorkspaceFile[] } : null;
};

const repositoryCoveragePayload: Validate<RepositoryCoveragePayload> = (body) => {
  const shape = fields(body);
  const files = shape?.files;
  const coverage = coverageSchema.safeParse(shape?.coverage);
  return Array.isArray(files) && files.every((file) => typeof file === "string") && coverage.success
    ? { files: files as string[], coverage: coverage.data }
    : null;
};

// DEBT(2026-11-12): the catalogue and the toolchain are checked one level deep — the catalogue's own `toolSchema` would bring `yaml` into the UI bundle, and the toolchain entries have no wire schema yet.
const catalogPayload: Validate<CatalogPayload> = (body) => {
  const shape = fields(body);
  return shape !== null &&
    Array.isArray(shape.tools) &&
    Array.isArray(shape.layers) &&
    fields(shape.logos) !== null
    ? (shape as CatalogPayload)
    : null;
};

const toolchainPayload: Validate<ToolchainPayload> = (body) => {
  const shape = fields(body);
  const toolchain = fields(shape?.toolchain);
  const valid =
    shape !== null &&
    typeof shape.text === "string" &&
    typeof shape.hash === "string" &&
    toolchain !== null &&
    Array.isArray(toolchain.services) &&
    Array.isArray(toolchain.integrations) &&
    Array.isArray(toolchain.dismissed) &&
    diagnosticList.safeParse(shape.diagnostics).success &&
    Array.isArray(shape.proposed) &&
    fields(shape.positions) !== null;
  return valid ? (shape as ToolchainPayload) : null;
};

const toolchainOperationPayload: Validate<ToolchainOperationPayload> = (body) => {
  const payload = toolchainPayload(body);
  const inverse = spliceSchema.safeParse(fields(body)?.inverse);
  return payload === null || !inverse.success ? null : { ...payload, inverse: inverse.data };
};

const positionsPayload: Validate<{ positions: Positions }> = (body) => {
  const positions = fields(fields(body)?.positions);
  return positions === null ? null : { positions: positions as Positions };
};

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

  private async call<T>(
    path: string,
    validate: Validate<T>,
    init: RequestInit = {},
  ): Promise<ApiResult<T>> {
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

    const value = validate(body);
    return value === null
      ? { ok: false, error: { status: response.status, code: UNEXPECTED_RESPONSE, params: {} } }
      : { ok: true, value };
  }

  workspace(): Promise<ApiResult<{ files: WorkspaceFile[] }>> {
    return this.call("/api/workspace", workspacePayload);
  }

  document(file: string): Promise<ApiResult<DocumentPayload>> {
    return this.call(`/api/documents/${encodeURIComponent(file)}`, documentPayload);
  }

  catalog(): Promise<ApiResult<CatalogPayload>> {
    return this.call("/api/catalog", catalogPayload);
  }

  preview(file: string, op: Operation): Promise<ApiResult<OperationPayload>> {
    return this.call(`/api/documents/${encodeURIComponent(file)}/preview`, operationPayload, {
      method: "POST",
      body: JSON.stringify({ op }),
    });
  }

  repositoryCoverage(): Promise<ApiResult<RepositoryCoveragePayload>> {
    return this.call("/api/coverage", repositoryCoveragePayload);
  }

  toolchain(): Promise<ApiResult<ToolchainPayload>> {
    return this.call("/api/toolchain", toolchainPayload);
  }

  submitToolchain(
    op: ToolchainOperation,
    opId: string,
  ): Promise<ApiResult<ToolchainOperationPayload>> {
    return this.call("/api/toolchain/operations", toolchainOperationPayload, {
      method: "POST",
      body: JSON.stringify({ op, opId }),
    });
  }

  savePositions(positions: Positions): Promise<ApiResult<{ positions: Positions }>> {
    return this.call("/api/layout/positions", positionsPayload, {
      method: "PUT",
      body: JSON.stringify({ positions }),
    });
  }

  clearPositions(): Promise<ApiResult<{ positions: Positions }>> {
    return this.call("/api/layout/positions", positionsPayload, {
      method: "PUT",
      body: JSON.stringify({ positions: {}, clear: true }),
    });
  }

  submit(file: string, op: Operation, opId: string): Promise<ApiResult<OperationPayload>> {
    return this.call(`/api/documents/${encodeURIComponent(file)}/operations`, operationPayload, {
      method: "POST",
      body: JSON.stringify({ op, opId }),
    });
  }
}
