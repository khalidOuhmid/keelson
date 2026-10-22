import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hashText } from "@keelson/core";
import { codeOf, type Harness, SAMPLE, startHarness } from "./support/harness.ts";

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.close();
});

async function currentHash(): Promise<string> {
  const body = (await (await harness.api("/api/documents/.gitlab-ci.yml")).json()) as {
    hash: string;
  };
  return body.hash;
}

async function post(body: unknown, init: RequestInit = {}): Promise<Response> {
  return harness.api("/api/documents/.gitlab-ci.yml/operations", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

describe("GET /api/workspace", () => {
  test("liste le fichier détecté avec son adaptateur", async () => {
    const response = await harness.api("/api/workspace");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      files: [{ path: ".gitlab-ci.yml", adapter: "gitlab" }],
    });
  });

  test("rend une liste vide quand aucun fichier CI n'est détecté", async () => {
    const vide = await startHarness({ text: null });
    const response = await vide.api("/api/workspace");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ files: [] });
    await vide.close();
  });

  test("refuse une autre méthode", async () => {
    const response = await harness.api("/api/workspace", { method: "DELETE" });
    expect(response.status).toBe(405);
    expect(await codeOf(response)).toBe("METHOD_NOT_ALLOWED");
  });
});

describe("GET /api/documents/:file", () => {
  test("rend text, pipeline, diagnostics et hash", async () => {
    const response = await harness.api("/api/documents/.gitlab-ci.yml");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.text).toBe(SAMPLE);
    expect(body.hash).toBe(hashText(SAMPLE));
    expect(Array.isArray(body.diagnostics)).toBe(true);
    expect((body.pipeline as { jobs: unknown[] }).jobs).toHaveLength(2);
  });

  test("rend 404 pour un fichier hors du workspace", async () => {
    const response = await harness.api("/api/documents/autre.yml");
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("NOT_FOUND");
  });

  test("accepte un nom de fichier encodé dans l'URL", async () => {
    const response = await harness.api(`/api/documents/${encodeURIComponent(".gitlab-ci.yml")}`);
    expect(response.status).toBe(200);
  });
});

describe("POST /api/documents/:file/operations", () => {
  test("applique l'opération et écrit le fichier", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: await currentHash(), kind: "addStage", name: "verify" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    for (const key of ["pipeline", "diagnostics", "hash", "inverse", "touched"]) {
      expect(body[key]).toBeDefined();
    }
    expect(readFileSync(harness.file, "utf8")).toContain("verify");
  });

  test("rend 400 INVALID_OPERATION sur un schéma invalide", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: await currentHash(), kind: "dropDatabase" },
    });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("INVALID_OPERATION");
  });

  test("rend 400 quand le corps n'est pas du JSON", async () => {
    const response = await post("pas du json{");
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("INVALID_OPERATION");
  });

  test("rend 400 quand opId manque", async () => {
    const response = await post({
      op: { v: 1, baseHash: await currentHash(), kind: "addStage", name: "verify" },
    });
    expect(response.status).toBe(400);
  });

  test("rend 409 STALE_DOCUMENT avec le hash courant", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "verify" },
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("STALE_DOCUMENT");
    expect(body.hash).toBe(hashText(SAMPLE));
  });

  test("rend 422 sur une erreur métier avec code, message et details", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: await currentHash(), kind: "removeJob", id: "compile" },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("JOB_REFERENCED");
    expect(typeof body.message).toBe("string");
    expect((body.details as { referencedBy: string[] }).referencedBy).toEqual(["unit"]);
  });

  test("rend 404 pour un fichier hors du workspace", async () => {
    const response = await harness.api("/api/documents/autre.yml/operations", {
      method: "POST",
      body: JSON.stringify({
        opId: "op-1",
        op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "x" },
      }),
    });
    expect(response.status).toBe(404);
  });

  test("refuse GET sur la route des opérations", async () => {
    const response = await harness.api("/api/documents/.gitlab-ci.yml/operations");
    expect(response.status).toBe(405);
  });

  test("le même opId rejoué rend la même réponse sans réécrire", async () => {
    const op = { v: 1, baseHash: await currentHash(), kind: "addStage", name: "verify" };
    const first = await (await post({ opId: "stable", op })).json();
    const content = readFileSync(harness.file, "utf8");
    const replay = await (await post({ opId: "stable", op })).json();
    expect(replay).toEqual(first);
    expect(readFileSync(harness.file, "utf8")).toBe(content);
  });
});

describe("limite de taille du corps", () => {
  test("rend 413 au-delà de 1 Mo", async () => {
    const response = await post({
      opId: "op-1",
      op: {
        v: 1,
        baseHash: "0".repeat(64),
        kind: "splice",
        start: 0,
        end: 0,
        text: "x".repeat(1_100_000),
      },
    });
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe("PAYLOAD_TOO_LARGE");
  });

  test("accepte un corps un peu en dessous de la limite", async () => {
    const response = await post({
      opId: "op-1",
      op: {
        v: 1,
        baseHash: await currentHash(),
        kind: "splice",
        start: 0,
        end: 0,
        text: `# ${"x".repeat(900_000)}\n`,
      },
    });
    expect(response.status).toBe(200);
  });
});

describe("forme des erreurs", () => {
  test("toute erreur porte code et message", async () => {
    const responses = await Promise.all([
      harness.api("/api/documents/absent.yml"),
      harness.api("/api/inconnu"),
      harness.api("/api/workspace", { method: "PUT" }),
    ]);

    for (const response of responses) {
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = (await response.json()) as Record<string, unknown>;
      expect(typeof body.code).toBe("string");
      expect(typeof body.message).toBe("string");
    }
  });

  test("une route API inconnue rend 404", async () => {
    expect((await harness.api("/api/inconnu")).status).toBe(404);
  });
});

describe("sans bundle d'UI", () => {
  test("une route hors API rend 404", async () => {
    expect((await harness.raw("/")).status).toBe(404);
  });
});
