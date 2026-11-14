import { describe, expect, test } from "bun:test";
import type { Pipeline } from "@keelson/core";
import { KeelsonClient } from "../src/api/client.ts";

const HASH = "a".repeat(64);

const PIPELINE: Pipeline = {
  stages: [{ name: "build", implicit: false, range: null, file: ".gitlab-ci.yml" }],
  jobs: [],
  templates: [],
  opaque: [],
  main: ".gitlab-ci.yml",
  files: [".gitlab-ci.yml"],
  unresolved: [],
};

const DOCUMENT = {
  text: "stages: [build]\n",
  pipeline: PIPELINE,
  diagnostics: [],
  hash: HASH,
  included: {},
  coverage: { jobs: [], layers: [], partial: false },
};

const OPERATION = {
  ...DOCUMENT,
  inverse: { v: 1, baseHash: HASH, kind: "splice", start: 0, end: 0, text: "" } as const,
  touched: [{ start: 0, end: 3 }],
};

function answering(status: number, body: unknown): KeelsonClient {
  return new KeelsonClient({
    token: "t",
    fetch: (async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch,
  });
}

describe("successful responses are validated", () => {
  test("a well-formed document passes", async () => {
    const result = await answering(200, DOCUMENT).document(".gitlab-ci.yml");
    expect(result).toEqual({ ok: true, value: DOCUMENT });
  });

  test("a document without jobs is an unexpected response, not a crash later", async () => {
    const broken = { ...DOCUMENT, pipeline: { ...PIPELINE, jobs: undefined } };
    const result = await answering(200, broken).document(".gitlab-ci.yml");
    expect(result).toEqual({
      ok: false,
      error: { status: 200, code: "UNEXPECTED_RESPONSE", params: {} },
    });
  });

  test("the repository coverage is read from GET /api/coverage and validated", async () => {
    const asked: string[] = [];
    const body = { files: [".gitlab-ci.yml"], coverage: DOCUMENT.coverage };
    const client = new KeelsonClient({
      token: "t",
      fetch: (async (url: string, init?: RequestInit) => {
        asked.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await client.repositoryCoverage()).toEqual({ ok: true, value: body });
    expect(asked).toEqual(["GET /api/coverage"]);

    const broken = await answering(200, { files: "x", coverage: {} }).repositoryCoverage();
    expect(broken.ok ? null : broken.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("clearing positions sends PUT /api/layout/positions with clear: true", async () => {
    const asked: string[] = [];
    const client = new KeelsonClient({
      token: "t",
      fetch: (async (url: string, init?: RequestInit) => {
        asked.push(`${init?.method ?? "GET"} ${url} ${String(init?.body)}`);
        return new Response(JSON.stringify({ positions: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await client.clearPositions()).toEqual({ ok: true, value: { positions: {} } });
    expect(asked).toEqual(['PUT /api/layout/positions {"positions":{},"clear":true}']);
  });

  test("a body that is not JSON is an unexpected response", async () => {
    const result = await answering(200, "<html>").document(".gitlab-ci.yml");
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("a diagnostic with partial params is refused", async () => {
    const broken = {
      ...DOCUMENT,
      diagnostics: [
        { code: "UNKNOWN_NEED", severity: "error", params: {}, range: null, file: "x" },
      ],
    };
    const result = await answering(200, broken).document(".gitlab-ci.yml");
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("an included text that is not a string is refused", async () => {
    const broken = { ...DOCUMENT, included: { "ci/a.yml": 3 } };
    const result = await answering(200, broken).document(".gitlab-ci.yml");
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("coverage naming an unknown layer is refused", async () => {
    const broken = {
      ...DOCUMENT,
      coverage: {
        jobs: [],
        layers: [{ layer: "magic", covered: true, jobs: [], services: [], ci: [] }],
        partial: false,
      },
    };
    const result = await answering(200, broken).document(".gitlab-ci.yml");
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("an operation response carries its inverse and the touched ranges", async () => {
    const client = answering(200, OPERATION);
    expect(await client.submit(".gitlab-ci.yml", OPERATION.inverse as never, "op")).toEqual({
      ok: true,
      value: OPERATION,
    });
    const withoutTouched = answering(200, { ...OPERATION, touched: undefined });
    const result = await withoutTouched.submit(".gitlab-ci.yml", OPERATION.inverse as never, "op");
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("a workspace entry with an unknown adapter is refused", async () => {
    const result = await answering(200, {
      files: [{ path: "Jenkinsfile", adapter: "jenkins" }],
    }).workspace();
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("a toolchain without its services list is refused", async () => {
    const result = await answering(200, {
      text: "",
      hash: HASH,
      toolchain: { integrations: [], dismissed: [] },
      diagnostics: [],
      proposed: [],
      positions: {},
    }).toolchain();
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });

  test("a catalogue without tools is refused", async () => {
    const result = await answering(200, { layers: [], logos: {} }).catalog();
    expect(result.ok ? null : result.error.code).toBe("UNEXPECTED_RESPONSE");
  });
});

describe("failures are validated", () => {
  test("well-formed params survive", async () => {
    const result = await answering(405, {
      code: "METHOD_NOT_ALLOWED",
      params: { method: "PUT" },
    }).document(".gitlab-ci.yml");
    expect(result).toEqual({
      ok: false,
      error: { status: 405, code: "METHOD_NOT_ALLOWED", params: { method: "PUT" } },
    });
  });

  test("partial params become an unexpected response: 'method undefined' is never rendered", async () => {
    const result = await answering(405, { code: "METHOD_NOT_ALLOWED", params: {} }).document(
      ".gitlab-ci.yml",
    );
    expect(result).toEqual({
      ok: false,
      error: { status: 405, code: "UNEXPECTED_RESPONSE", params: {} },
    });
  });
});
