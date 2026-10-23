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

  test("rend 422 sur une erreur métier avec code et params", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: await currentHash(), kind: "removeJob", id: "compile" },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "JOB_REFERENCED",
      params: { job: "compile", referencedBy: ["unit"] },
    });
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
  /** Un chemin d'erreur par entrée, et pour chacun la forme **exacte** du corps. `toEqual` plutôt
   *  qu'une suite de `toBe` : c'est la seule façon de faire échouer le test si une clé `message`
   *  réapparaît, et c'est précisément ce que ce lot interdit. Le 413, le 403 Host et le 403 token
   *  sont couverts dans leurs describe respectifs, avec leur mise en scène propre. */
  const paths: {
    label: string;
    call: () => Promise<Response>;
    status: number;
    body: Record<string, unknown>;
  }[] = [
    {
      label: "405 sur une méthode refusée",
      call: () => harness.api("/api/workspace", { method: "PUT" }),
      status: 405,
      body: { code: "METHOD_NOT_ALLOWED", params: { method: "PUT" } },
    },
    {
      // Le flux lit son token dans la requête, pas dans un en-tête : `raw` plus `?token=`, sinon
      // le 403 du token arrive avant le 405 et le chemin de la méthode n'est jamais atteint.
      label: "405 sur le flux d'événements",
      call: () =>
        harness.raw(`/api/events?token=${encodeURIComponent(harness.server.token)}`, {
          method: "DELETE",
        }),
      status: 405,
      body: { code: "METHOD_NOT_ALLOWED", params: { method: "DELETE" } },
    },
    {
      label: "403 sans token sur une route API",
      call: () => harness.raw("/api/workspace"),
      status: 403,
      body: { code: "FORBIDDEN_TOKEN", params: {} },
    },
    {
      label: "403 sur un en-tête Host étranger",
      call: () => harness.api("/api/workspace", { headers: { host: "evil.example.com" } }),
      status: 403,
      body: { code: "FORBIDDEN_HOST", params: {} },
    },
    {
      label: "405 sur la route des opérations",
      call: () => harness.api("/api/documents/.gitlab-ci.yml/operations"),
      status: 405,
      body: { code: "METHOD_NOT_ALLOWED", params: { method: "GET" } },
    },
    {
      label: "404 sur un document hors du workspace",
      call: () => harness.api("/api/documents/absent.yml"),
      status: 404,
      body: { code: "NOT_FOUND", params: { reason: "unknownFile", file: "absent.yml" } },
    },
    {
      label: "404 sur une route API inconnue",
      call: () => harness.api("/api/inconnu"),
      status: 404,
      body: { code: "NOT_FOUND", params: { reason: "unknownRoute", route: "/api/inconnu" } },
    },
    {
      label: "404 sur une opération visant un fichier hors du workspace",
      call: () =>
        harness.api("/api/documents/autre.yml/operations", {
          method: "POST",
          body: JSON.stringify({
            opId: "op-1",
            op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "x" },
          }),
        }),
      status: 404,
      body: { code: "NOT_FOUND", params: { reason: "unknownFile", file: "autre.yml" } },
    },
    {
      label: "400 sur un corps illisible",
      call: () => post("pas du json{"),
      status: 400,
      body: { code: "INVALID_OPERATION", params: { reason: "unreadableBody" } },
    },
    {
      label: "400 sans opId",
      call: () => post({ op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "x" } }),
      status: 400,
      body: { code: "INVALID_OPERATION", params: { reason: "missingOpId" } },
    },
    {
      label: "400 sans op",
      call: () => post({ opId: "op-1" }),
      status: 400,
      body: { code: "INVALID_OPERATION", params: { reason: "missingOp" } },
    },
    {
      label: "400 sur une version d'opération non supportée",
      call: () => post({ opId: "op-1", op: { v: 2, baseHash: "0".repeat(64), kind: "addStage" } }),
      status: 400,
      body: { code: "UNSUPPORTED_VERSION", params: { received: 2, supported: 1 } },
    },
  ];

  for (const { label, call, status, body } of paths) {
    test(label, async () => {
      const response = await call();
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual(body);
    });
  }

  test("400 sur un schéma invalide : le détail de zod passe en params, sans message", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: await currentHash(), kind: "dropDatabase" },
    });
    expect(response.status).toBe(400);
    const parsed = (await response.json()) as { code: string; params: Record<string, unknown> };
    expect(Object.keys(parsed).sort()).toEqual(["code", "params"]);
    expect(parsed.code).toBe("INVALID_OPERATION");
    expect(parsed.params.reason).toBe("schema");
    expect(typeof parsed.params.detail).toBe("string");
  });

  test("409 porte le hash courant en plus de code et params, et rien d'autre", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "verify" },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "STALE_DOCUMENT",
      params: { expected: hashText(SAMPLE), received: "0".repeat(64) },
      hash: hashText(SAMPLE),
    });
  });
});

describe("sans bundle d'UI", () => {
  test("une route hors API rend 404", async () => {
    expect((await harness.raw("/")).status).toBe(404);
  });
});
