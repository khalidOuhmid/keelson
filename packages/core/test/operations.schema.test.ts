import { describe, expect, test } from "bun:test";
import { renderMessage } from "@keelson/core/messages";
import type { OperationErrorCode } from "../src/operations.ts";
import {
  INVALID_OPERATION,
  OPERATION_VERSION,
  operationSchema,
  parseOperation,
  UNSUPPORTED_VERSION,
} from "../src/operations.ts";

const HASH = "a".repeat(64);

function withBase<T extends Record<string, unknown>>(operation: T) {
  return { v: OPERATION_VERSION, baseHash: HASH, ...operation };
}

function expectAccepted(operation: Record<string, unknown>): void {
  const result = parseOperation(withBase(operation));
  if (!result.ok) {
    throw new Error(`operation rejected although it is valid: ${renderMessage(result.error)}`);
  }
  expect(String(result.value.kind)).toBe(String(operation.kind));
}

function expectRejected(operation: unknown, code: OperationErrorCode): void {
  const result = parseOperation(operation);
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  expect(result.error.code).toBe(code);
}

describe("valid operations", () => {
  test("addJob minimal", () => {
    expectAccepted({
      kind: "addJob",
      job: { id: "unit", stage: "test", script: ["bun test"] },
    });
  });

  test("full addJob", () => {
    expectAccepted({
      kind: "addJob",
      job: {
        id: "deploy",
        stage: "deploy",
        script: ["./deploy.sh"],
        needs: [{ job: "build", optional: true, artifacts: false }],
        environment: { name: "production", url: "https://example.org", action: "start" },
      },
    });
  });

  test("removeJob", () => {
    expectAccepted({ kind: "removeJob", id: "unit" });
  });

  test("renameJob", () => {
    expectAccepted({ kind: "renameJob", from: "unit", to: "unit-tests" });
  });

  test("setJobStage", () => {
    expectAccepted({ kind: "setJobStage", id: "unit", stage: "verify" });
  });

  test("addNeed", () => {
    expectAccepted({ kind: "addNeed", id: "unit", need: { job: "build" } });
  });

  test("removeNeed", () => {
    expectAccepted({ kind: "removeNeed", id: "unit", job: "build" });
  });

  test("setEnvironment with a value", () => {
    expectAccepted({ kind: "setEnvironment", id: "deploy", environment: { name: "staging" } });
  });

  test("setEnvironment to null", () => {
    expectAccepted({ kind: "setEnvironment", id: "deploy", environment: null });
  });

  test("addStage without index", () => {
    expectAccepted({ kind: "addStage", name: "verify" });
  });

  test("addStage with index", () => {
    expectAccepted({ kind: "addStage", name: "verify", index: 2 });
  });

  test("moveStage", () => {
    expectAccepted({ kind: "moveStage", name: "verify", toIndex: 0 });
  });

  test("splice", () => {
    expectAccepted({ kind: "splice", start: 0, end: 10, text: "image: node\n" });
  });

  test("splice with empty text", () => {
    expectAccepted({ kind: "splice", start: 4, end: 9, text: "" });
  });
});

describe("version", () => {
  test("rejects an unknown version", () => {
    expectRejected({ v: 2, baseHash: HASH, kind: "removeJob", id: "unit" }, UNSUPPORTED_VERSION);
  });

  test("rejects version 0", () => {
    expectRejected({ v: 0, baseHash: HASH, kind: "removeJob", id: "unit" }, UNSUPPORTED_VERSION);
  });

  test("rejects a missing version", () => {
    expectRejected({ baseHash: HASH, kind: "removeJob", id: "unit" }, INVALID_OPERATION);
  });

  test("rejects a non-numeric version", () => {
    expectRejected({ v: "1", baseHash: HASH, kind: "removeJob", id: "unit" }, INVALID_OPERATION);
  });
});

describe("invalid operations", () => {
  test("rejects an unknown kind", () => {
    expectRejected(withBase({ kind: "dropDatabase", id: "unit" }), INVALID_OPERATION);
  });

  test("rejects a missing kind", () => {
    expectRejected(withBase({ id: "unit" }), INVALID_OPERATION);
  });

  test("rejects a missing baseHash", () => {
    expectRejected({ v: OPERATION_VERSION, kind: "removeJob", id: "unit" }, INVALID_OPERATION);
  });

  test("rejects a baseHash that is not hex SHA-256", () => {
    expectRejected(
      { v: OPERATION_VERSION, baseHash: "not-a-hash", kind: "removeJob", id: "unit" },
      INVALID_OPERATION,
    );
  });

  test("rejects an uppercase baseHash", () => {
    expectRejected(
      { v: OPERATION_VERSION, baseHash: "A".repeat(64), kind: "removeJob", id: "unit" },
      INVALID_OPERATION,
    );
  });

  test("rejects an unknown field", () => {
    expectRejected(withBase({ kind: "removeJob", id: "unit", force: true }), INVALID_OPERATION);
  });

  test("rejects addJob without script", () => {
    expectRejected(
      withBase({ kind: "addJob", job: { id: "unit", stage: "test" } }),
      INVALID_OPERATION,
    );
  });

  test("rejects addJob with a script that is not an array of strings", () => {
    expectRejected(
      withBase({ kind: "addJob", job: { id: "unit", stage: "test", script: "bun test" } }),
      INVALID_OPERATION,
    );
  });

  test("rejects a need without job", () => {
    expectRejected(
      withBase({ kind: "addNeed", id: "unit", need: { optional: true } }),
      INVALID_OPERATION,
    );
  });

  test("rejects an environment without name", () => {
    expectRejected(
      withBase({ kind: "setEnvironment", id: "d", environment: { url: "https://x" } }),
      INVALID_OPERATION,
    );
  });

  test("rejects setEnvironment with a missing environment", () => {
    expectRejected(withBase({ kind: "setEnvironment", id: "d" }), INVALID_OPERATION);
  });

  test("rejects a negative stage index", () => {
    expectRejected(withBase({ kind: "addStage", name: "v", index: -1 }), INVALID_OPERATION);
  });

  test("rejects a non-integer stage index", () => {
    expectRejected(withBase({ kind: "addStage", name: "v", index: 1.5 }), INVALID_OPERATION);
  });

  test("rejects a splice with negative bounds", () => {
    expectRejected(withBase({ kind: "splice", start: -1, end: 3, text: "" }), INVALID_OPERATION);
  });

  test("rejects an operation that is not an object", () => {
    expectRejected("removeJob", INVALID_OPERATION);
    expectRejected(null, INVALID_OPERATION);
    expectRejected([], INVALID_OPERATION);
  });
});

describe("names", () => {
  test("the schema accepts an empty name, legality is checked when applying", () => {
    expectAccepted({ kind: "renameJob", from: "unit", to: "" });
  });

  test("the schema accepts a name starting with a dot", () => {
    expectAccepted({ kind: "renameJob", from: "unit", to: ".cache" });
  });
});

describe("operationSchema", () => {
  test("is exported and usable directly", () => {
    const parsed = operationSchema.safeParse(withBase({ kind: "removeJob", id: "unit" }));
    expect(parsed.success).toBe(true);
  });

  test("does not mutate its input", () => {
    const input = withBase({ kind: "removeJob", id: "unit" });
    const snapshot = JSON.stringify(input);
    parseOperation(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
