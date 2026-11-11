import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import { createServer, detectWorkspace, type KeelsonServer } from "../src/index.ts";

const WORKFLOW = `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: make
  scan:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: aquasecurity/trivy-action@0.28.0
`;

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "keelson-github-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

let server: KeelsonServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function open(root: string) {
  server = await createServer({ root, port: 0 });
  const running = server;
  return (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${running.port}${path}`, {
      ...init,
      headers: {
        "x-keelson-token": running.token,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
    });
}

const FILE = ".github/workflows/ci.yml";
const ENCODED = encodeURIComponent(FILE);

describe("détection de l'espace de travail", () => {
  test("liste les workflows GitHub, triés, après le fichier GitLab", () => {
    const root = repository({
      ".gitlab-ci.yml": "a:\n  script: [x]\n",
      ".github/workflows/release.yaml": WORKFLOW,
      ".github/workflows/ci.yml": WORKFLOW,
      ".github/workflows/README.md": "pas un workflow",
      ".github/dependabot.yml": "version: 2\n",
    });
    expect(detectWorkspace(root)).toEqual([
      { path: ".gitlab-ci.yml", adapter: "gitlab" },
      { path: ".github/workflows/ci.yml", adapter: "github" },
      { path: ".github/workflows/release.yaml", adapter: "github" },
    ]);
  });

  test("un dépôt sans dossier de workflows ne liste rien de GitHub", () => {
    expect(detectWorkspace(repository({}))).toEqual([]);
  });
});

describe("un workflow GitHub servi par l'API", () => {
  test("se charge avec son pipeline, ses diagnostics et sa couverture", async () => {
    const api = await open(repository({ [FILE]: WORKFLOW }));
    const response = await api(`/api/documents/${ENCODED}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      text: string;
      hash: string;
      pipeline: { jobs: { id: string }[]; main: string };
      coverage: { jobs: { job: string; tools: string[] }[] };
      diagnostics: unknown[];
    };
    expect(body.text).toBe(WORKFLOW);
    expect(body.hash).toBe(hashText(WORKFLOW));
    expect(body.pipeline.main).toBe(FILE);
    expect(body.pipeline.jobs.map((job) => job.id)).toEqual(["build", "scan"]);
    expect(body.coverage.jobs.find((job) => job.job === "scan")?.tools).toContain("trivy");
    expect(body.diagnostics).toEqual([]);
  });

  test("refuse une opération en 422 READ_ONLY_ADAPTER et n'écrit rien", async () => {
    const root = repository({ [FILE]: WORKFLOW });
    const api = await open(root);
    const op = { v: 1, baseHash: hashText(WORKFLOW), kind: "removeJob", id: "scan" };
    for (const route of ["operations", "preview"]) {
      const response = await api(`/api/documents/${ENCODED}/${route}`, {
        method: "POST",
        body: JSON.stringify({ op, opId: `op-${route}` }),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        code: "READ_ONLY_ADAPTER",
        params: { adapter: "github", file: FILE },
      });
    }
    expect(readFileSync(join(root, FILE), "utf8")).toBe(WORKFLOW);
  });
});
