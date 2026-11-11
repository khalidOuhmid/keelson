import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
  test("returns the resulting text and its coverage, without writing", async () => {
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

  test("the document hash does not move", async () => {
    await post(OP);
    const after = (await (await harness.api("/api/documents/.gitlab-ci.yml")).json()) as {
      hash: string;
    };
    expect(after.hash).toBe(hashText(MAIN));
  });

  test("the refusals are those of an operation", async () => {
    expect((await post({ ...OP, id: "compile" })).status).toBe(422);
    expect((await post({ ...OP, baseHash: "a".repeat(64) })).status).toBe(409);
    expect((await post({ kind: "x" })).status).toBe(400);
    expect((await harness.api("/api/documents/.gitlab-ci.yml/preview")).status).toBe(405);
  });

  test("an external write the watcher has not seen is left to it", async () => {
    const external = `${MAIN}# externe\n`;
    writeFileSync(harness.file, external);
    const stream = await harness.raw(`/api/events?token=${harness.server.token}`);
    const reader = stream.body?.getReader();
    expect((await post(OP)).status).toBe(409);
    let seen = "";
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && !seen.includes("document.changed")) {
      const chunk = await Promise.race([
        reader?.read(),
        new Promise<undefined>((settle) => setTimeout(settle, 100)),
      ]);
      seen += chunk?.value === undefined ? "" : new TextDecoder().decode(chunk.value);
    }
    await reader?.cancel();
    expect(seen).toContain("document.changed");
  });

  test("a deleted file is left for the watcher to announce", async () => {
    rmSync(harness.file);
    expect((await post(OP)).status).toBe(404);
    const stream = await harness.raw(`/api/events?token=${harness.server.token}`);
    const reader = stream.body?.getReader();
    let seen = "";
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && !seen.includes("document.removed")) {
      const chunk = await Promise.race([
        reader?.read(),
        new Promise<undefined>((settle) => setTimeout(settle, 100)),
      ]);
      seen += chunk?.value === undefined ? "" : new TextDecoder().decode(chunk.value);
    }
    await reader?.cancel();
    expect(seen).toContain("document.removed");
  });

  test("a refused operation does not use up an opId, the insertion then goes through", async () => {
    await post(OP);
    const response = await harness.api("/api/documents/.gitlab-ci.yml/operations", {
      method: "POST",
      body: JSON.stringify({ op: OP, opId: "x" }),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(harness.file, "utf8")).toContain("trivy fs .");
  });
});
