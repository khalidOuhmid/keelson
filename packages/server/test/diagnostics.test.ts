import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperationBody } from "../src/store.ts";
import { DocumentStore } from "../src/store.ts";
import { detectWorkspace } from "../src/workspace.ts";

const WITH_UNKNOWN_NEED = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
  "unit:",
  "  stage: test",
  "  needs:",
  "    - absent",
  "  script:",
  "    - make check",
  "",
].join("\n");

let root = "";
let store: DocumentStore;

function load(text: string): DocumentStore {
  root = mkdtempSync(join(tmpdir(), "keelson-diag-"));
  writeFileSync(join(root, ".gitlab-ci.yml"), text);
  return new DocumentStore(root, detectWorkspace(root));
}

beforeEach(() => {
  store = load(WITH_UNKNOWN_NEED);
});

describe("diagnostics returned by the server", () => {
  test("the document carries validation diagnostics, not just parse ones", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    expect(loaded?.diagnostics.map((diagnostic) => diagnostic.code)).toContain("UNKNOWN_NEED");
  });

  test("parse diagnostics are kept", async () => {
    const withInclude = load(
      ["include:", "  - template: Jobs/SAST.gitlab-ci.yml", "", "stages:", "  - test", ""].join(
        "\n",
      ),
    );
    const loaded = await withInclude.load(".gitlab-ci.yml");
    expect(loaded?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "INCLUDE_UNRESOLVED",
    );
  });

  test("both families coexist on the same file", async () => {
    const both = load(
      [
        "include:",
        "  - template: Jobs/SAST.gitlab-ci.yml",
        "",
        "stages:",
        "  - test",
        "",
        "unit:",
        "  stage: test",
        "  needs:",
        "    - absent",
        "  script:",
        "    - x",
        "",
      ].join("\n"),
    );
    const codes = (await both.load(".gitlab-ci.yml"))?.diagnostics.map(
      (diagnostic) => diagnostic.code,
    );
    expect(codes).toContain("INCLUDE_UNRESOLVED");
    expect(codes).toContain("UNKNOWN_NEED");
  });

  test("a needs cycle is reported", async () => {
    const cyclic = load(
      [
        "stages:",
        "  - test",
        "",
        "a:",
        "  stage: test",
        "  needs:",
        "    - b",
        "  script:",
        "    - x",
        "",
        "b:",
        "  stage: test",
        "  needs:",
        "    - a",
        "  script:",
        "    - y",
        "",
      ].join("\n"),
    );
    const codes = (await cyclic.load(".gitlab-ci.yml"))?.diagnostics.map(
      (diagnostic) => diagnostic.code,
    );
    expect(codes).toContain("NEEDS_CYCLE");
  });

  test("an operation's response also carries validation diagnostics", async () => {
    const loaded = await store.load(".gitlab-ci.yml");
    const result = await store.applyOperation(
      ".gitlab-ci.yml",
      { v: 1, baseHash: loaded?.hash ?? "", kind: "addStage", name: "verify" },
      "op-1",
    );
    expect(result.status).toBe(200);
    const body = result.body as OperationBody;
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toContain("UNKNOWN_NEED");
  });

  test("a healthy file carries no diagnostics", async () => {
    const clean = load(
      ["stages:", "  - test", "", "unit:", "  stage: test", "  script:", "    - x", ""].join("\n"),
    );
    expect((await clean.load(".gitlab-ci.yml"))?.diagnostics).toEqual([]);
  });
});
