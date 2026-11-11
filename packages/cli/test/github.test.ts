import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.ts";

const FILE = ".github/workflows/ci.yml";

const WORKFLOW = `on: push
jobs:
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@v2
  sast:
    runs-on: ubuntu-latest
    needs: [secrets, ghost]
    steps:
      - run: semgrep ci
`;

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-cli-github-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, FILE), WORKFLOW);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("keelson sur un workflow GitHub Actions", () => {
  test("validate lit le workflow par l'adaptateur GitHub et situe ses diagnostics", async () => {
    const result = await run(["validate", FILE, "--format", "json"], { cwd: root });
    const reported = JSON.parse(result.stdout) as { code: string; line: number; file: string }[];
    expect(reported.map((entry) => entry.code)).toEqual(["UNKNOWN_NEED"]);
    expect(reported[0]?.file).toBe(join(root, FILE));
    expect(result.exitCode).toBe(1);
  });

  test("coverage détecte par les actions comme par les scripts", async () => {
    const result = await run(["coverage", FILE, "--format", "json"], { cwd: root });
    const body = JSON.parse(result.stdout) as {
      layers: { layer: string; covered: boolean; jobs: string[] }[];
    };
    const layer = (id: string) => body.layers.find((entry) => entry.layer === id);
    expect(layer("secrets")?.jobs).toEqual(["secrets"]);
    expect(layer("sast")?.jobs).toEqual(["sast"]);
  });
});
