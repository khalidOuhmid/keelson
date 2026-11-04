import { readInsideRoot } from "@keelson/adapter-gitlab";
import { loadCatalog } from "@keelson/catalog";
import type { Diagnostic, MessageCode, ParamsOf, SpliceOperation, Toolchain } from "@keelson/core";
import {
  emptyPipeline,
  hashText,
  INVALID_OPERATION,
  parseToolchainOperation,
  STALE_DOCUMENT,
  TOOLCHAIN_FILE,
} from "@keelson/core";
import {
  analyseToolchain,
  applyToolchain,
  LAYOUT_FILE,
  type Positions,
  type ProposedIntegration,
  parseLayout,
  parsePositions,
  writePositions,
} from "@keelson/toolchain";
import { type DocumentStore, OPID_HISTORY } from "./store.ts";
import { writeInsideRoot } from "./write.ts";

export type ToolchainBody = {
  text: string;
  hash: string;
  toolchain: Toolchain;
  diagnostics: Diagnostic[];
  proposed: ProposedIntegration[];
  positions: Positions;
};

type ErrorBody = {
  [C in MessageCode]: { code: C; params: ParamsOf<C>; hash?: string };
}[MessageCode];

export type ToolchainResponse = {
  status: 200 | 400 | 409 | 422;
  body: (ToolchainBody & { inverse: SpliceOperation }) | ErrorBody;
};

export type PositionsResponse = {
  status: 200 | 400 | 422;
  body: { positions: Positions } | ErrorBody;
};

/** `.devsecops/toolchain.yaml`. Une seule file d'écriture : deux opérations concurrentes ne peuvent
 *  pas se fonder sur le même texte. */
export class ToolchainStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly seen = new Map<string, ToolchainResponse>();

  constructor(
    private readonly root: string,
    private readonly documents: DocumentStore,
  ) {}

  private text(): string {
    return readInsideRoot(this.root, TOOLCHAIN_FILE) ?? "";
  }

  private async pipeline() {
    const main = this.documents.workspaceFiles()[0]?.path;
    if (main === undefined) {
      return emptyPipeline("");
    }
    if (this.documents.currentPipeline(main) === undefined) {
      await this.documents.load(main);
    }
    return this.documents.currentPipeline(main) ?? emptyPipeline(main);
  }

  private async body(text: string): Promise<ToolchainBody> {
    const pipeline = await this.pipeline();
    const { toolchain, diagnostics, proposed } = analyseToolchain(
      text === "" ? null : text,
      pipeline,
      loadCatalog().tools,
    );
    const layout = parseLayout(readInsideRoot(this.root, LAYOUT_FILE), pipeline);
    return {
      text,
      hash: hashText(text),
      toolchain,
      diagnostics,
      proposed,
      positions: layout.positions,
    };
  }

  load(): Promise<ToolchainBody> {
    return this.body(this.text());
  }

  apply(operation: unknown, opId: string): Promise<ToolchainResponse> {
    const next = this.queue.then(() => this.run(operation, opId));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async run(operation: unknown, opId: string): Promise<ToolchainResponse> {
    const replay = this.seen.get(opId);
    if (replay !== undefined) {
      return replay;
    }

    const response = await this.execute(operation);
    this.seen.set(opId, response);
    if (this.seen.size > OPID_HISTORY) {
      const oldest = this.seen.keys().next();
      if (oldest.done !== true) {
        this.seen.delete(oldest.value);
      }
    }
    return response;
  }

  private async execute(operation: unknown): Promise<ToolchainResponse> {
    const validated = parseToolchainOperation(operation);
    if (!validated.ok) {
      return { status: 400, body: validated.error };
    }

    const text = this.text();
    const result = applyToolchain(text, validated.value);
    if (!result.ok) {
      return result.error.code === STALE_DOCUMENT
        ? { status: 409, body: { ...result.error, hash: hashText(text) } }
        : { status: 422, body: result.error };
    }

    if (result.value.text !== text) {
      const written = await writeInsideRoot(this.root, TOOLCHAIN_FILE, result.value.text);
      if (!written) {
        return {
          status: 422,
          body: {
            code: INVALID_OPERATION,
            params: { reason: "outsideRoot", path: TOOLCHAIN_FILE },
          },
        };
      }
    }

    return {
      status: 200,
      body: { ...(await this.body(result.value.text)), inverse: result.value.inverse },
    };
  }

  /** Dans la même file que les opérations : `layout.json` se relit juste avant d'être réécrit. */
  savePositions(raw: unknown): Promise<PositionsResponse> {
    const next = this.queue.then(() => this.writePositions(raw));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async writePositions(raw: unknown): Promise<PositionsResponse> {
    const parsed = parsePositions(raw);
    if (!parsed.ok) {
      return {
        status: 400,
        body: {
          code: INVALID_OPERATION,
          params: { reason: "schema", path: parsed.path, detail: parsed.detail },
        },
      };
    }

    const text = writePositions(readInsideRoot(this.root, LAYOUT_FILE), parsed.positions);
    if (text === null) {
      return {
        status: 422,
        body: { code: INVALID_OPERATION, params: { reason: "invalidLayout" } },
      };
    }
    if (!(await writeInsideRoot(this.root, LAYOUT_FILE, text))) {
      return {
        status: 422,
        body: { code: INVALID_OPERATION, params: { reason: "outsideRoot", path: LAYOUT_FILE } },
      };
    }
    return { status: 200, body: { positions: parsed.positions } };
  }
}
