import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import { createServer, type KeelsonServer } from "../src/index.ts";
import { detectWorkspace } from "../src/workspace.ts";

const CI =
  "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: trivy fs .\n";
const REL =
  "on: push\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: gitleaks/gitleaks-action@v2\n";

let root: string;
let server: KeelsonServer;

const api = (path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${server.port}${path}`, {
    ...init,
    headers: {
      "x-keelson-token": server.token,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
  });

const documentPath = (file: string) => `/api/documents/${encodeURIComponent(file)}`;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "keelson-gh-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), CI);
  writeFileSync(join(root, ".github/workflows/release.yaml"), REL);
  writeFileSync(join(root, ".github/workflows/notes.txt"), "not a workflow");
  server = await createServer({ root, port: 0 });
});

afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true });
});

describe("workspace GitHub Actions", () => {
  test("detects every workflow, sorted, and nothing else", () => {
    expect(detectWorkspace(root)).toEqual([
      { path: ".github/workflows/ci.yml", adapter: "github" },
      { path: ".github/workflows/release.yaml", adapter: "github" },
    ]);
  });

  test(".gitlab-ci.yml comes first", () => {
    writeFileSync(join(root, ".gitlab-ci.yml"), "a:\n  script: x\n");
    expect(detectWorkspace(root).map((file) => file.adapter)).toEqual([
      "gitlab",
      "github",
      "github",
    ]);
  });

  test("a repository without a .github directory does not throw", () => {
    const empty = mkdtempSync(join(tmpdir(), "keelson-none-"));
    expect(detectWorkspace(empty)).toEqual([]);
    rmSync(empty, { recursive: true });
  });
});

describe("several files", () => {
  test("an integration to a job in another workflow is not an on-screen error", async () => {
    mkdirSync(join(root, ".devsecops"));
    writeFileSync(
      join(root, ".devsecops/toolchain.yaml"),
      "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: publish\n    service: n\n    kind: push\n",
    );
    const body = (await (await api(documentPath(".github/workflows/ci.yml"))).json()) as {
      diagnostics: { code: string }[];
    };
    expect(body.diagnostics.map((entry) => entry.code)).not.toContain("TOOLCHAIN_UNKNOWN_JOB");
  });

  test("layout.json notifies every open file", async () => {
    await api(documentPath(".github/workflows/ci.yml"));
    await api(documentPath(".github/workflows/release.yaml"));
    const stream = await fetch(`http://127.0.0.1:${server.port}/api/events?token=${server.token}`);
    const reader = stream.body?.getReader();
    mkdirSync(join(root, ".devsecops"));
    writeFileSync(join(root, ".devsecops/layout.json"), '{"version":1}');
    let seen = "";
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && !(seen.includes("ci.yml") && seen.includes("release.yaml"))) {
      const chunk = await Promise.race([
        reader?.read(),
        new Promise<undefined>((settle) => setTimeout(settle, 100)),
      ]);
      seen += chunk?.value === undefined ? "" : new TextDecoder().decode(chunk.value);
    }
    await reader?.cancel();
    expect(seen).toContain("ci.yml");
    expect(seen).toContain("release.yaml");
  });
});

describe("a workflow created while the server runs", () => {
  test("arrives as workspace.changed on the stream and in GET /api/workspace", async () => {
    const stream = await fetch(`http://127.0.0.1:${server.port}/api/events?token=${server.token}`);
    const reader = stream.body?.getReader();
    writeFileSync(join(root, ".github/workflows/lint.yml"), CI);
    let seen = "";
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && !seen.includes("lint.yml")) {
      const chunk = await Promise.race([
        reader?.read(),
        new Promise<undefined>((settle) => setTimeout(settle, 100)),
      ]);
      seen += chunk?.value === undefined ? "" : new TextDecoder().decode(chunk.value);
    }
    await reader?.cancel();
    const files = [
      { path: ".github/workflows/ci.yml", adapter: "github" },
      { path: ".github/workflows/lint.yml", adapter: "github" },
      { path: ".github/workflows/release.yaml", adapter: "github" },
    ];
    expect(seen).toContain(`event: workspace.changed\ndata: ${JSON.stringify({ files })}\n\n`);
    expect(await (await api("/api/workspace")).json()).toEqual({ files });
    expect((await api(documentPath(".github/workflows/lint.yml"))).status).toBe(200);
  });
});

describe("a neighbouring file the parser cannot read", () => {
  test("the healthy document still opens", async () => {
    await server.close();
    writeFileSync(join(root, ".gitlab-ci.yml"), "job:\n  script: &s [x, *s]\n");
    server = await createServer({ root, port: 0 });
    expect((await api(documentPath(".github/workflows/ci.yml"))).status).toBe(200);
  });
});

describe("GitHub documents", () => {
  test("GET returns the IR, the provider and coverage", async () => {
    const body = (await (await api(documentPath(".github/workflows/ci.yml"))).json()) as {
      pipeline: { provider: string; jobs: { id: string }[] };
      coverage: { jobs: { job: string; layers: string[] }[] };
    };
    expect(body.pipeline.provider).toBe("github");
    expect(body.coverage.jobs[0]?.layers).toContain("sca");
  });

  test("an official action counts towards coverage", async () => {
    const body = (await (await api(documentPath(".github/workflows/release.yaml"))).json()) as {
      coverage: { jobs: { layers: string[] }[] };
    };
    expect(body.coverage.jobs[0]?.layers).toContain("secrets");
  });

  test("an operation writes the right file", async () => {
    await api(documentPath(".github/workflows/ci.yml"));
    const response = await api(`${documentPath(".github/workflows/ci.yml")}/operations`, {
      method: "POST",
      body: JSON.stringify({
        opId: "a",
        op: { v: 1, baseHash: hashText(CI), kind: "removeJob", id: "build" },
      }),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")).not.toContain("build:");
    expect(readFileSync(join(root, ".github/workflows/release.yaml"), "utf8")).toBe(REL);
  });

  test("an operation that makes no sense here returns 422", async () => {
    await api(documentPath(".github/workflows/ci.yml"));
    const response = await api(`${documentPath(".github/workflows/ci.yml")}/operations`, {
      method: "POST",
      body: JSON.stringify({
        opId: "b",
        op: { v: 1, baseHash: hashText(CI), kind: "addStage", name: "x" },
      }),
    });
    expect(response.status).toBe(422);
  });

  test("the toolchain sees the jobs of every workflow", async () => {
    mkdirSync(join(root, ".devsecops"));
    writeFileSync(
      join(root, ".devsecops/toolchain.yaml"),
      "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: build\n    service: n\n    kind: push\n  - job: publish\n    service: n\n    kind: push\n",
    );
    const body = (await (await api("/api/toolchain")).json()) as { diagnostics: unknown[] };
    expect(body.diagnostics).toEqual([]);
  });
});
