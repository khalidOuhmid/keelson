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

describe("une seule vérité pour le hash d'une réponse", () => {
  test("le hash rendu par une opération est accepté par la suivante", async () => {
    const first = await addStage(await hashOf(), "verify", "op-1");
    expect(first.status).toBe(200);
    const returned = ((await first.json()) as { hash: string }).hash;

    // C'est la conséquence que le défaut aurait produite : le cache répondant 409 contre un hash
    // que le client n'a jamais reçu. Pas de rechargement entre les deux, exprès.
    const second = await addStage(returned, "publish", "op-2");
    expect(second.status).toBe(200);
  });

  test("le hash rendu est aussi celui que le serveur garde en cache", async () => {
    const response = await addStage(await hashOf(), "verify", "op-1");
    const returned = ((await response.json()) as { hash: string }).hash;
    expect(await hashOf()).toBe(returned);
  });

  /** Garde **structurel**, et il l'est par nécessité : les deux expressions que ce lot a fusionnées
   *  rendaient la même valeur, parce qu'`apply` rend `parse(texte).hash`. Aucun test de
   *  comportement ne peut donc rougir sur la duplication — seule sa divergence future le ferait, et
   *  ce serait trop tard. Ce qui se vérifie ici est donc le nombre de hash que le store calcule
   *  lui-même par requête : zéro. Il n'en reprend qu'un, celui de l'adaptateur. */
  test("le store ne calcule aucun hash lui-même", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "store.ts"), "utf8");
    const calls = source.match(/hashText\s*\(/g) ?? [];
    expect(calls).toEqual([]);
  });
});
