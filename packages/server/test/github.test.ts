import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import { createServer, type KeelsonServer } from "../src/index.ts";
import { DocumentStore } from "../src/store.ts";
import { type DocumentEvent, watchDocuments } from "../src/watcher.ts";
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

describe("a local reusable workflow", () => {
  const CALLER =
    "on: push\njobs:\n  scans:\n    uses: ./.github/workflows/scans.yml\n  deploy:\n    needs: scans\n    runs-on: x\n    steps:\n      - run: ./deploy\n";
  const SCANS =
    "on: workflow_call\njobs:\n  leaks:\n    runs-on: x\n    steps:\n      - run: gitleaks detect\n";

  test("is read through the bounded reader: the calling job covers what it runs", async () => {
    writeFileSync(join(root, ".github/workflows/caller.yml"), CALLER);
    writeFileSync(join(root, ".github/workflows/scans.yml"), SCANS);
    await server.close();
    server = await createServer({ root, port: 0 });
    const body = (await (await api(documentPath(".github/workflows/caller.yml"))).json()) as {
      pipeline: { files: string[]; unresolved: unknown[] };
      coverage: { jobs: { job: string; layers: string[] }[] };
      included: Record<string, string>;
    };
    expect(body.coverage.jobs.find((entry) => entry.job === "scans")?.layers).toContain("secrets");
    expect(body.pipeline.files).toEqual([
      ".github/workflows/caller.yml",
      ".github/workflows/scans.yml",
    ]);
    expect(body.pipeline.unresolved).toEqual([]);
    expect(body.included).toEqual({ ".github/workflows/scans.yml": SCANS });
  });

  test("a called workflow that is also a workspace file reloads its caller and itself", async () => {
    writeFileSync(join(root, ".github/workflows/caller.yml"), CALLER);
    writeFileSync(join(root, ".github/workflows/scans.yml"), SCANS);
    const store = new DocumentStore(root, detectWorkspace(root));
    await store.load(".github/workflows/caller.yml");
    await store.load(".github/workflows/scans.yml");
    const events: DocumentEvent[] = [];
    const watcher = watchDocuments(root, store, (event) => events.push(event));
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      writeFileSync(join(root, ".github/workflows/scans.yml"), SCANS.replace("gitleaks", "trivy"));
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline && events.length < 2) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(events.map((event) => ("file" in event ? event.file : "")).sort()).toEqual([
        ".github/workflows/caller.yml",
        ".github/workflows/scans.yml",
      ]);
      const caller = await store.load(".github/workflows/caller.yml");
      expect(caller?.pipeline.jobs[0]?.signals.script).toEqual(["trivy detect"]);
    } finally {
      watcher.close();
    }
  });
});
