import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync } from "node:fs";
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
  test("lists the detected file with its adapter", async () => {
    const response = await harness.api("/api/workspace");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      files: [{ path: ".gitlab-ci.yml", adapter: "gitlab" }],
    });
  });

  test("returns an empty list when no CI file is detected", async () => {
    const vide = await startHarness({ text: null });
    const response = await vide.api("/api/workspace");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ files: [] });
    await vide.close();
  });

  test("refuses another method", async () => {
    const response = await harness.api("/api/workspace", { method: "DELETE" });
    expect(response.status).toBe(405);
    expect(await codeOf(response)).toBe("METHOD_NOT_ALLOWED");
  });
});

describe("GET /api/documents/:file", () => {
  test("returns text, pipeline, diagnostics and hash", async () => {
    const response = await harness.api("/api/documents/.gitlab-ci.yml");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.text).toBe(SAMPLE);
    expect(body.hash).toBe(hashText(SAMPLE));
    expect(Array.isArray(body.diagnostics)).toBe(true);
    expect((body.pipeline as { jobs: unknown[] }).jobs).toHaveLength(2);
  });

  test("returns 404 for a file outside the workspace", async () => {
    const response = await harness.api("/api/documents/autre.yml");
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("NOT_FOUND");
  });

  test("accepts a URL-encoded file name", async () => {
    const response = await harness.api(`/api/documents/${encodeURIComponent(".gitlab-ci.yml")}`);
    expect(response.status).toBe(200);
  });
});

describe("POST /api/documents/:file/operations", () => {
  test("applies the operation and writes the file", async () => {
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

  test("returns 400 INVALID_OPERATION on an invalid schema", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: await currentHash(), kind: "dropDatabase" },
    });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("INVALID_OPERATION");
  });

  test("returns 400 when the body is not JSON", async () => {
    const response = await post("pas du json{");
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("INVALID_OPERATION");
  });

  test("returns 400 when opId is missing", async () => {
    const response = await post({
      op: { v: 1, baseHash: await currentHash(), kind: "addStage", name: "verify" },
    });
    expect(response.status).toBe(400);
  });

  test("returns 409 STALE_DOCUMENT with the current hash", async () => {
    const response = await post({
      opId: "op-1",
      op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "verify" },
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("STALE_DOCUMENT");
    expect(body.hash).toBe(hashText(SAMPLE));
  });

  test("returns 422 on a domain error with code and params", async () => {
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

  test("returns 404 for a file outside the workspace", async () => {
    const response = await harness.api("/api/documents/autre.yml/operations", {
      method: "POST",
      body: JSON.stringify({
        opId: "op-1",
        op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "x" },
      }),
    });
    expect(response.status).toBe(404);
  });

  test("refuses GET on the operations route", async () => {
    const response = await harness.api("/api/documents/.gitlab-ci.yml/operations");
    expect(response.status).toBe(405);
  });

  test("the same opId replayed returns the same response without rewriting", async () => {
    const op = { v: 1, baseHash: await currentHash(), kind: "addStage", name: "verify" };
    const first = await (await post({ opId: "stable", op })).json();
    const content = readFileSync(harness.file, "utf8");
    const replay = await (await post({ opId: "stable", op })).json();
    expect(replay).toEqual(first);
    expect(readFileSync(harness.file, "utf8")).toBe(content);
  });
});

describe("body size limit", () => {
  test("returns 413 beyond 1 MB", async () => {
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

  test("accepts a body slightly under the limit", async () => {
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

describe("error shape", () => {
  /** One error path per entry, and for each the **exact** shape of the body. `toEqual` rather than a
   *  series of `toBe`: it is the only way to make the test fail if a `message` key reappears, and
   *  that is precisely what this milestone forbids.
   *
   *  The table covers every path except `INTERNAL_ERROR`, which requires making the handler throw
   *  and so lives in its own describe. The review of 2026-10-22 found that the previous version of
   *  this comment sent the 413 off to "its describe", where only the **code** was checked: yet the
   *  413 is the only body the server serialises by hand, outside the `fail()` that guarantees the
   *  shape. It was therefore the least guarded path, described as covered. It is in the table now. */
  const paths: {
    label: string;
    call: () => Promise<Response>;
    status: number;
    body: Record<string, unknown>;
  }[] = [
    {
      label: "405 on a refused method",
      call: () => harness.api("/api/workspace", { method: "PUT" }),
      status: 405,
      body: { code: "METHOD_NOT_ALLOWED", params: { method: "PUT" } },
    },
    {
      // The stream reads its token from the query, not from a header: `raw` plus `?token=`, otherwise
      // the token's 403 arrives before the 405 and the method path is never reached.
      label: "405 on the event stream",
      call: () =>
        harness.raw(`/api/events?token=${encodeURIComponent(harness.server.token)}`, {
          method: "DELETE",
        }),
      status: 405,
      body: { code: "METHOD_NOT_ALLOWED", params: { method: "DELETE" } },
    },
    {
      label: "403 without a token on an API route",
      call: () => harness.raw("/api/workspace"),
      status: 403,
      body: { code: "FORBIDDEN_TOKEN", params: {} },
    },
    {
      label: "403 on a foreign Host header",
      call: () => harness.api("/api/workspace", { headers: { host: "evil.example.com" } }),
      status: 403,
      body: { code: "FORBIDDEN_HOST", params: {} },
    },
    {
      label: "405 on the operations route",
      call: () => harness.api("/api/documents/.gitlab-ci.yml/operations"),
      status: 405,
      body: { code: "METHOD_NOT_ALLOWED", params: { method: "GET" } },
    },
    {
      label: "404 on a document outside the workspace",
      call: () => harness.api("/api/documents/absent.yml"),
      status: 404,
      body: { code: "NOT_FOUND", params: { reason: "unknownFile", file: "absent.yml" } },
    },
    {
      // A lone `%` is an invalid escape: `decodeURIComponent` throws.
      label: "404 on an undecodable file name, document route",
      call: () => harness.api("/api/documents/%"),
      status: 404,
      body: { code: "NOT_FOUND", params: { reason: "unreadableFileName" } },
    },
    {
      label: "404 on an undecodable file name, operations route",
      call: () =>
        harness.api("/api/documents/%/operations", {
          method: "POST",
          body: JSON.stringify({ opId: "op-1", op: {} }),
        }),
      status: 404,
      body: { code: "NOT_FOUND", params: { reason: "unreadableFileName" } },
    },
    {
      // The only body the server serialises by hand, hence the only one that could drift from the
      // shape without `fail()` preventing it.
      label: "413 beyond the body limit",
      call: () =>
        post({
          opId: "op-1",
          op: {
            v: 1,
            baseHash: "0".repeat(64),
            kind: "splice",
            start: 0,
            end: 0,
            text: "x".repeat(1_100_000),
          },
        }),
      status: 413,
      body: { code: "PAYLOAD_TOO_LARGE", params: { limitBytes: 1_048_576 } },
    },
    {
      label: "404 on an unknown API route",
      call: () => harness.api("/api/inconnu"),
      status: 404,
      body: { code: "NOT_FOUND", params: { reason: "unknownRoute", route: "/api/inconnu" } },
    },
    {
      label: "404 on an operation targeting a file outside the workspace",
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
      label: "400 on an unreadable body",
      call: () => post("pas du json{"),
      status: 400,
      body: { code: "INVALID_OPERATION", params: { reason: "unreadableBody" } },
    },
    {
      label: "400 without opId",
      call: () => post({ op: { v: 1, baseHash: "0".repeat(64), kind: "addStage", name: "x" } }),
      status: 400,
      body: { code: "INVALID_OPERATION", params: { reason: "missingOpId" } },
    },
    {
      label: "400 without op",
      call: () => post({ opId: "op-1" }),
      status: 400,
      body: { code: "INVALID_OPERATION", params: { reason: "missingOp" } },
    },
    {
      label: "400 on an unsupported operation version",
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

  test("400 on an invalid schema: the zod detail goes into params, without a message", async () => {
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

  test("409 carries the current hash on top of code and params, and nothing else", async () => {
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

describe("INTERNAL_ERROR", () => {
  /** The sixth transport code, and the only one the shape table cannot reach: the handler has to
   *  **throw**. The atomic write goes through a temporary file in the document's directory; a
   *  directory without write permission therefore makes it fail, and the exception bubbles up to
   *  `createServer`'s safety net. Found missing by the review of 2026-10-22. */
  test("a throwing handler returns 500 with code and params, and no detail", async () => {
    const hash = await currentHash();
    chmodSync(harness.root, 0o500);
    try {
      const response = await post({
        opId: "op-1",
        op: { v: 1, baseHash: hash, kind: "addStage", name: "verify" },
      });
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      // No detail exposed: neither path nor exception message.
      expect(await response.json()).toEqual({ code: "INTERNAL_ERROR", params: {} });
    } finally {
      chmodSync(harness.root, 0o700);
    }
  });
});

describe("without a UI bundle", () => {
  test("a non-API route returns 404 with the expected shape", async () => {
    const response = await harness.raw("/");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      params: { reason: "noUiBundle" },
    });
  });
});
