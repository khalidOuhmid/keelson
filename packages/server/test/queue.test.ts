import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import type { ErrorBody } from "../src/store.ts";
import { DocumentStore } from "../src/store.ts";
import { detectWorkspace } from "../src/workspace.ts";

const BASE = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
  "unit:",
  "  stage: test",
  "  script:",
  "    - make check",
  "",
].join("\n");

let root = "";
let store: DocumentStore;

function makeStore(text = BASE): DocumentStore {
  root = mkdtempSync(join(tmpdir(), "keelson-queue-"));
  writeFileSync(join(root, ".gitlab-ci.yml"), text);
  return new DocumentStore(root, detectWorkspace(root));
}

beforeEach(() => {
  store = makeStore();
});

describe("file d'attente par document", () => {
  test("deux opérations lancées en parallèle sont appliquées en série", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded).not.toBeNull();
    const first = store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: loaded?.hash ?? "",
        kind: "addStage",
        name: "verify",
      },
      "op-1",
    );

    const second = first.then(() =>
      store.applyOperation(
        ".gitlab-ci.yml",
        {
          v: 1,
          baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
          kind: "addStage",
          name: "publish",
        },
        "op-2",
      ),
    );

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toContain("verify");
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toContain("publish");
  });

  test("deux opérations concurrentes sur le même hash : la seconde est périmée, aucune n'est perdue", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const baseHash = loaded?.hash ?? "";

    const results = await Promise.all([
      store.applyOperation(
        ".gitlab-ci.yml",
        { v: 1, baseHash, kind: "addStage", name: "verify" },
        "op-a",
      ),
      store.applyOperation(
        ".gitlab-ci.yml",
        { v: 1, baseHash, kind: "addStage", name: "publish" },
        "op-b",
      ),
    ]);

    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);

    const stale = results.find((result) => result.status === 409);
    expect((stale?.body as ErrorBody | undefined)?.code).toBe("STALE_DOCUMENT");
    expect((stale?.body as ErrorBody | undefined)?.hash).toBe(store.currentHash(".gitlab-ci.yml"));

    const onDisk = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    const applied = results.find((result) => result.status === 200);
    expect(applied).toBeDefined();
    expect(store.currentText(".gitlab-ci.yml")).toBe(onDisk);
  });

  test("dix opérations enchaînées aboutissent toutes", async () => {
    await store.load(".gitlab-ci.yml");
    for (let index = 0; index < 10; index += 1) {
      const result = await store.applyOperation(
        ".gitlab-ci.yml",
        {
          v: 1,
          baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
          kind: "addStage",
          name: `etape-${index}`,
        },
        `op-${index}`,
      );
      expect(result.status).toBe(200);
    }
    const text = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    for (let index = 0; index < 10; index += 1) {
      expect(text).toContain(`etape-${index}`);
    }
  });

  test("le hash courant suit le dernier état écrit", async () => {
    await store.load(".gitlab-ci.yml");
    await store.applyOperation(
      ".gitlab-ci.yml",
      {
        v: 1,
        baseHash: store.currentHash(".gitlab-ci.yml") ?? "",
        kind: "addStage",
        name: "verify",
      },
      "op-1",
    );
    const onDisk = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    expect(store.currentHash(".gitlab-ci.yml")).toBe(hashText(onDisk));
  });

  test("une erreur métier n'écrit rien et laisse le hash inchangé", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const before = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "removeJob", id: "absent" },
      "op-ko",
    );
    expect(result.status).toBe(422);
    expect((result.body as ErrorBody).code).toBe("JOB_NOT_FOUND");
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(before);
    expect(store.currentHash(".gitlab-ci.yml")).toBe(loaded?.hash);
  });

  test("une opération au schéma invalide rend 400 sans écrire", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const before = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "dropDatabase" } as never,
      "op-bad",
    );
    expect(result.status).toBe(400);
    expect((result.body as ErrorBody).code).toBe("INVALID_OPERATION");
    expect(readFileSync(join(root, ".gitlab-ci.yml"), "utf8")).toBe(before);
  });

  test("un fichier hors de la liste du workspace rend 404", async () => {
    const result = await store.applyOperation(
      "autre.yml",
      { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "x" },
      "op-404",
    );
    expect(result.status).toBe(404);
  });

  test("la réponse réussie porte pipeline, diagnostics, hash, inverse et touched", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "addStage", name: "verify" },
      "op-1",
    );
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    for (const key of ["pipeline", "diagnostics", "hash", "inverse", "touched"]) {
      expect(body[key]).toBeDefined();
    }
  });
});
