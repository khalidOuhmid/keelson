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
  writeFileSync(join(root, ".github/workflows/notes.txt"), "pas un workflow");
  server = await createServer({ root, port: 0 });
});

afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true });
});

describe("workspace GitHub Actions", () => {
  test("détecte chaque workflow, trié, et rien d'autre", () => {
    expect(detectWorkspace(root)).toEqual([
      { path: ".github/workflows/ci.yml", adapter: "github" },
      { path: ".github/workflows/release.yaml", adapter: "github" },
    ]);
  });

  test(".gitlab-ci.yml passe en premier", () => {
    writeFileSync(join(root, ".gitlab-ci.yml"), "a:\n  script: x\n");
    expect(detectWorkspace(root).map((file) => file.adapter)).toEqual([
      "gitlab",
      "github",
      "github",
    ]);
  });

  test("un dépôt sans dossier .github ne lève pas", () => {
    const empty = mkdtempSync(join(tmpdir(), "keelson-none-"));
    expect(detectWorkspace(empty)).toEqual([]);
    rmSync(empty, { recursive: true });
  });
});

describe("documents GitHub", () => {
  test("GET rend l'IR, le fournisseur et la couverture", async () => {
    const body = (await (await api(documentPath(".github/workflows/ci.yml"))).json()) as {
      pipeline: { provider: string; jobs: { id: string }[] };
      coverage: { jobs: { job: string; layers: string[] }[] };
    };
    expect(body.pipeline.provider).toBe("github");
    expect(body.coverage.jobs[0]?.layers).toContain("sca");
  });

  test("une action officielle compte dans la couverture", async () => {
    const body = (await (await api(documentPath(".github/workflows/release.yaml"))).json()) as {
      coverage: { jobs: { layers: string[] }[] };
    };
    expect(body.coverage.jobs[0]?.layers).toContain("secrets");
  });

  test("une opération écrit le bon fichier", async () => {
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

  test("une opération sans objet ici rend 422", async () => {
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

  test("la toolchain voit les jobs de tous les workflows", async () => {
    mkdirSync(join(root, ".devsecops"));
    writeFileSync(
      join(root, ".devsecops/toolchain.yaml"),
      "version: 1\nservices:\n  n:\n    tool: nexus\nintegrations:\n  - job: build\n    service: n\n    kind: push\n  - job: publish\n    service: n\n    kind: push\n",
    );
    const body = (await (await api("/api/toolchain")).json()) as { diagnostics: unknown[] };
    expect(body.diagnostics).toEqual([]);
  });
});
