import { readInsideRoot } from "@keelson/adapter-gitlab";
import { loadCatalog } from "@keelson/catalog";
import type {
  Diagnostic,
  MessageCode,
  ParamsOf,
  Pipeline,
  SpliceOperation,
  Toolchain,
} from "@keelson/core";
import {
  emptyPipeline,
  hashText,
  INVALID_OPERATION,
  mergePipelines,
  parseToolchainOperation,
  STALE_DOCUMENT,
  TOOLCHAIN_FILE,
  TOOLCHAIN_INVALID,
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
import { type Disk, readDisk } from "./disk.ts";
import { type DocumentStore, OPID_HISTORY } from "./store.ts";
import { blockedParent, writeInsideRoot } from "./write.ts";

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

/** What `keelson start` and `keelson validate` both say about a toolchain they cannot read. */
export function unreadableToolchain(): Diagnostic {
  return {
    code: TOOLCHAIN_INVALID,
    severity: "error",
    params: { detail: "the file cannot be read" },
    range: null,
    file: TOOLCHAIN_FILE,
  };
}

/** `.devsecops/toolchain.yaml`. A single write queue: two concurrent operations cannot be based on
 *  the same text. */
export class ToolchainStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly seen = new Map<string, ToolchainResponse>();

  constructor(
    private readonly root: string,
    private readonly documents: DocumentStore,
  ) {}

  private read(path: string): Disk {
    return readDisk(this.root, path);
  }

  /** A toolchain is repository-wide: its jobs are those of every file in the workspace. */
  private async repository(): Promise<{ pipeline: Pipeline; parsing: Diagnostic[] }> {
    const files = this.documents.workspaceFiles().map((entry) => entry.path);
    const pipelines: Pipeline[] = [];
    const parsing: Diagnostic[] = [];
    for (const file of files) {
      if (this.documents.currentPipeline(file) === undefined) {
        await this.documents.load(file);
      }
      const pipeline = this.documents.currentPipeline(file);
      if (pipeline !== undefined) {
        pipelines.push(pipeline);
        parsing.push(...(this.documents.currentParsing(file) ?? []));
      }
    }
    return { pipeline: mergePipelines(pipelines), parsing };
  }

  private async body(text: string): Promise<ToolchainBody> {
    const { pipeline, parsing } = await this.repository();
    const { toolchain, diagnostics, proposed } = analyseToolchain(
      text === "" ? null : text,
      pipeline,
      loadCatalog().tools,
      parsing,
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

  async load(): Promise<ToolchainBody> {
    const disk = this.read(TOOLCHAIN_FILE);
    const body = await this.body(disk.kind === "text" ? disk.text : "");
    return disk.kind === "unreadable"
      ? { ...body, diagnostics: [unreadableToolchain(), ...body.diagnostics] }
      : body;
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

    const disk = this.read(TOOLCHAIN_FILE);
    if (disk.kind === "unreadable") {
      return {
        status: 422,
        body: { code: INVALID_OPERATION, params: { reason: "invalidToolchain" } },
      };
    }
    const text = disk.kind === "text" ? disk.text : "";
    const result = applyToolchain(text, validated.value);
    if (!result.ok) {
      return result.error.code === STALE_DOCUMENT
        ? { status: 409, body: { ...result.error, hash: hashText(text) } }
        : { status: 422, body: result.error };
    }

    if (result.value.text !== text) {
      if (!(await writeInsideRoot(this.root, TOOLCHAIN_FILE, result.value.text))) {
        return { status: 422, body: this.unwritable(TOOLCHAIN_FILE) };
      }
    }

    return {
      status: 200,
      body: { ...(await this.body(result.value.text)), inverse: result.value.inverse },
    };
  }

  /** The same refusal as `keelson apply`: a parent that is a regular file is not an escape. */
  private unwritable(path: string): ErrorBody {
    const blocked = blockedParent(this.root, path);
    return blocked === null
      ? { code: INVALID_OPERATION, params: { reason: "outsideRoot", path } }
      : { code: INVALID_OPERATION, params: { reason: "notADirectory", path: blocked } };
  }

  /** In the same queue as operations: `layout.json` is re-read just before being rewritten. */
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

    const disk = this.read(LAYOUT_FILE);
    const text =
      disk.kind === "unreadable"
        ? null
        : writePositions(disk.kind === "text" ? disk.text : null, parsed.positions);
    if (text === null) {
      return {
        status: 422,
        body: { code: INVALID_OPERATION, params: { reason: "invalidLayout" } },
      };
    }
    if (!(await writeInsideRoot(this.root, LAYOUT_FILE, text))) {
      return { status: 422, body: this.unwritable(LAYOUT_FILE) };
    }
    return { status: 200, body: { positions: parseLayout(text, emptyPipeline("")).positions } };
  }
}
