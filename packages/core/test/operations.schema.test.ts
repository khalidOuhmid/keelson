import { describe, expect, test } from "bun:test";
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
    throw new Error(`opération refusée alors qu'elle est valide : ${result.error.message}`);
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

describe("opérations valides", () => {
  test("addJob minimal", () => {
    expectAccepted({
      kind: "addJob",
      job: { id: "unit", stage: "test", script: ["bun test"] },
    });
  });

  test("addJob complet", () => {
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
    expectAccepted({ kind: "renameJob", from: "unit", to: "tests-unitaires" });
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

  test("setEnvironment avec une valeur", () => {
    expectAccepted({ kind: "setEnvironment", id: "deploy", environment: { name: "staging" } });
  });

  test("setEnvironment à null", () => {
    expectAccepted({ kind: "setEnvironment", id: "deploy", environment: null });
  });

  test("addStage sans index", () => {
    expectAccepted({ kind: "addStage", name: "verify" });
  });

  test("addStage avec index", () => {
    expectAccepted({ kind: "addStage", name: "verify", index: 2 });
  });

  test("moveStage", () => {
    expectAccepted({ kind: "moveStage", name: "verify", toIndex: 0 });
  });

  test("splice", () => {
    expectAccepted({ kind: "splice", start: 0, end: 10, text: "image: node\n" });
  });

  test("splice avec texte vide", () => {
    expectAccepted({ kind: "splice", start: 4, end: 9, text: "" });
  });
});

describe("version", () => {
  test("rejette une version inconnue", () => {
    expectRejected({ v: 2, baseHash: HASH, kind: "removeJob", id: "unit" }, UNSUPPORTED_VERSION);
  });

  test("rejette la version 0", () => {
    expectRejected({ v: 0, baseHash: HASH, kind: "removeJob", id: "unit" }, UNSUPPORTED_VERSION);
  });

  test("rejette une version absente", () => {
    expectRejected({ baseHash: HASH, kind: "removeJob", id: "unit" }, INVALID_OPERATION);
  });

  test("rejette une version non numérique", () => {
    expectRejected({ v: "1", baseHash: HASH, kind: "removeJob", id: "unit" }, INVALID_OPERATION);
  });
});

describe("opérations invalides", () => {
  test("rejette un kind inconnu", () => {
    expectRejected(withBase({ kind: "dropDatabase", id: "unit" }), INVALID_OPERATION);
  });

  test("rejette un kind absent", () => {
    expectRejected(withBase({ id: "unit" }), INVALID_OPERATION);
  });

  test("rejette un baseHash absent", () => {
    expectRejected({ v: OPERATION_VERSION, kind: "removeJob", id: "unit" }, INVALID_OPERATION);
  });

  test("rejette un baseHash qui n'est pas du SHA-256 hexadécimal", () => {
    expectRejected(
      { v: OPERATION_VERSION, baseHash: "pas-un-hash", kind: "removeJob", id: "unit" },
      INVALID_OPERATION,
    );
  });

  test("rejette un baseHash en majuscules", () => {
    expectRejected(
      { v: OPERATION_VERSION, baseHash: "A".repeat(64), kind: "removeJob", id: "unit" },
      INVALID_OPERATION,
    );
  });

  test("rejette un champ inconnu", () => {
    expectRejected(withBase({ kind: "removeJob", id: "unit", force: true }), INVALID_OPERATION);
  });

  test("rejette addJob sans script", () => {
    expectRejected(
      withBase({ kind: "addJob", job: { id: "unit", stage: "test" } }),
      INVALID_OPERATION,
    );
  });

  test("rejette addJob avec un script qui n'est pas un tableau de chaînes", () => {
    expectRejected(
      withBase({ kind: "addJob", job: { id: "unit", stage: "test", script: "bun test" } }),
      INVALID_OPERATION,
    );
  });

  test("rejette un need sans job", () => {
    expectRejected(
      withBase({ kind: "addNeed", id: "unit", need: { optional: true } }),
      INVALID_OPERATION,
    );
  });

  test("rejette un environnement sans nom", () => {
    expectRejected(
      withBase({ kind: "setEnvironment", id: "d", environment: { url: "https://x" } }),
      INVALID_OPERATION,
    );
  });

  test("rejette setEnvironment avec environment absent", () => {
    expectRejected(withBase({ kind: "setEnvironment", id: "d" }), INVALID_OPERATION);
  });

  test("rejette un index de stage négatif", () => {
    expectRejected(withBase({ kind: "addStage", name: "v", index: -1 }), INVALID_OPERATION);
  });

  test("rejette un index de stage non entier", () => {
    expectRejected(withBase({ kind: "addStage", name: "v", index: 1.5 }), INVALID_OPERATION);
  });

  test("rejette un splice aux bornes négatives", () => {
    expectRejected(withBase({ kind: "splice", start: -1, end: 3, text: "" }), INVALID_OPERATION);
  });

  test("rejette une opération qui n'est pas un objet", () => {
    expectRejected("removeJob", INVALID_OPERATION);
    expectRejected(null, INVALID_OPERATION);
    expectRejected([], INVALID_OPERATION);
  });
});

describe("noms", () => {
  test("le schéma accepte un nom vide, la légalité est vérifiée à l'application", () => {
    expectAccepted({ kind: "renameJob", from: "unit", to: "" });
  });

  test("le schéma accepte un nom commençant par un point", () => {
    expectAccepted({ kind: "renameJob", from: "unit", to: ".cache" });
  });
});

describe("operationSchema", () => {
  test("est exporté et utilisable directement", () => {
    const parsed = operationSchema.safeParse(withBase({ kind: "removeJob", id: "unit" }));
    expect(parsed.success).toBe(true);
  });

  test("ne mute pas l'entrée", () => {
    const input = withBase({ kind: "removeJob", id: "unit" });
    const snapshot = JSON.stringify(input);
    parseOperation(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
