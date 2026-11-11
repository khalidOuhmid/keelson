import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Harness, startHarness } from "./support/harness.ts";

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.close();
});

async function hashOf(): Promise<string> {
  const body = (await (await harness.api("/api/documents/.gitlab-ci.yml")).json()) as {
    hash: string;
  };
  return body.hash;
}

function addStage(baseHash: string, name: string, opId: string): Promise<Response> {
  return harness.api("/api/documents/.gitlab-ci.yml/operations", {
    method: "POST",
    body: JSON.stringify({ opId, op: { v: 1, baseHash, kind: "addStage", name } }),
  });
}

describe("a single truth for a response's hash", () => {
  /** These first two tests describe the invariant, **but do not guard the duplication**: the two
   *  expressions merged by milestone L2c returned the same value, because `apply` returns
   *  `parse(text).hash`. They stay green with the defect reintroduced, and it is the third test that
   *  protects. Keeping them has a distinct value: they would turn red if the returned hash ever
   *  stopped being the one the server then accepts, whatever the cause. */
  test("the hash returned by an operation is accepted by the next one", async () => {
    const first = await addStage(await hashOf(), "verify", "op-1");
    expect(first.status).toBe(200);
    const returned = ((await first.json()) as { hash: string }).hash;

    // No reload in between, on purpose: the client only has what the response told it.
    const second = await addStage(returned, "publish", "op-2");
    expect(second.status).toBe(200);
  });

  test("the returned hash is also the one the server caches", async () => {
    const response = await addStage(await hashOf(), "verify", "op-1");
    const returned = ((await response.json()) as { hash: string }).hash;
    expect(await hashOf()).toBe(returned);
  });

  /** **This test, and this test alone, guards the duplication.** It is structural by necessity:
   *  the two expressions returned the same value, so no behaviour test can turn red on it — only
   *  their future divergence would, and that would be too late. What is checked here is the number
   *  of hashes the store computes itself per request: zero. It only takes one over, the adapter's.
   *
   *  Both forms are searched for: the direct call to `hashText`, and the detour through
   *  `parse(…).hash` that the first version of the guard let through — found by the review of
   *  2026-10-22. */
  test("the store computes no hash itself", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "store.ts"), "utf8");
    // Comments are stripped first: a guard that reads the prose of the file it watches fires on
    // its own explanation, and it is the comment that ends up being rewritten.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const recomputations = [
      ...(code.match(/hashText\s*\(/g) ?? []),
      ...(code.match(/parse\s*\([^)]*\)\s*\.hash/g) ?? []),
    ];
    expect(recomputations).toEqual([]);
  });
});
