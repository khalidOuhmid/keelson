import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hashText } from "@keelson/core";
import { type Harness, startHarness } from "./support/harness.ts";

const MAIN = "stages:\n  - test\n\ncompile:\n  stage: test\n  script:\n    - make\n";
const SNIPPET = "trivy:\n  stage: test\n  script:\n    - trivy fs .\n";
const OP = {
  v: 1,
  baseHash: hashText(MAIN),
  kind: "addSnippet",
  id: "trivy",
  stage: "test",
  snippet: SNIPPET,
};

let harness: Harness;

const post = (op: unknown) =>
  harness.api("/api/documents/.gitlab-ci.yml/preview", {
    method: "POST",
    body: JSON.stringify({ op }),
  });

beforeEach(async () => {
  harness = await startHarness({ text: MAIN });
  await harness.api("/api/documents/.gitlab-ci.yml");
});

afterEach(async () => {
  await harness.close();
});

describe("POST /api/documents/:file/preview", () => {
  test("rend le texte d'après et sa couverture, sans écrire", async () => {
    const response = await post(OP);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      text: string;
      coverage: { jobs: { job: string; layers: string[] }[] };
    };
    expect(body.text).toContain("trivy fs .");
    expect(body.coverage.jobs.find((job) => job.job === "trivy")?.layers).toContain("sca");
    expect(readFileSync(harness.file, "utf8")).toBe(MAIN);
  });

  test("le hash du document ne bouge pas", async () => {
    await post(OP);
    const after = (await (await harness.api("/api/documents/.gitlab-ci.yml")).json()) as {
      hash: string;
    };
    expect(after.hash).toBe(hashText(MAIN));
  });

  test("les refus sont ceux d'une opération", async () => {
    expect((await post({ ...OP, id: "compile" })).status).toBe(422);
    expect((await post({ ...OP, baseHash: "a".repeat(64) })).status).toBe(409);
    expect((await post({ kind: "x" })).status).toBe(400);
    expect((await harness.api("/api/documents/.gitlab-ci.yml/preview")).status).toBe(405);
  });

  test("une opération refusée n'occupe pas d'opId, l'insertion passe ensuite", async () => {
    await post(OP);
    const response = await harness.api("/api/documents/.gitlab-ci.yml/operations", {
      method: "POST",
      body: JSON.stringify({ op: OP, opId: "x" }),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(harness.file, "utf8")).toContain("trivy fs .");
  });
});
