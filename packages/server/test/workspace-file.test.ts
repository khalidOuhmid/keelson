import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "../src/store.ts";
import type { WorkspaceFile } from "../src/workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-workspace-file-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a workspace file is a YAML file", () => {
  test("the type only accepts a .yml or .yaml path", () => {
    const accepted: WorkspaceFile[] = [
      { path: ".gitlab-ci.yml", adapter: "gitlab" },
      { path: ".github/workflows/ci.yaml", adapter: "github" },
    ];
    // @ts-expect-error the store reads through the YAML-only reader: a Jenkinsfile would never load
    const refused: WorkspaceFile = { path: "Jenkinsfile", adapter: "gitlab" };
    expect(accepted).toHaveLength(2);
    expect(refused.path as string).toBe("Jenkinsfile");
  });

  test("the store does not load a main file whose real path is not YAML", async () => {
    writeFileSync(join(root, "Jenkinsfile"), "stages: [build]\n");
    const files = [{ path: "Jenkinsfile", adapter: "gitlab" }] as unknown as WorkspaceFile[];
    const store = new DocumentStore(root, files);
    expect(await store.load("Jenkinsfile")).toBeNull();
  });
});
