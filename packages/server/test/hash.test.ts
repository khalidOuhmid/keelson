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
  /** Ces deux premiers tests décrivent l'invariant, **mais ne gardent pas la duplication** : les
   *  deux expressions fusionnées par le lot L2c rendaient la même valeur, parce qu'`apply` rend
   *  `parse(texte).hash`. Ils restent verts avec le défaut réintroduit, et c'est le troisième test
   *  qui protège. Les garder a une valeur distincte : ils rougiraient si le hash rendu cessait un
   *  jour d'être celui que le serveur accepte ensuite, quelle qu'en soit la cause. */
  test("le hash rendu par une opération est accepté par la suivante", async () => {
    const first = await addStage(await hashOf(), "verify", "op-1");
    expect(first.status).toBe(200);
    const returned = ((await first.json()) as { hash: string }).hash;

    // Pas de rechargement entre les deux, exprès : le client n'a que ce que la réponse lui a dit.
    const second = await addStage(returned, "publish", "op-2");
    expect(second.status).toBe(200);
  });

  test("le hash rendu est aussi celui que le serveur garde en cache", async () => {
    const response = await addStage(await hashOf(), "verify", "op-1");
    const returned = ((await response.json()) as { hash: string }).hash;
    expect(await hashOf()).toBe(returned);
  });

  /** **C'est ce test, et lui seul, qui garde la duplication.** Il est structurel par nécessité :
   *  les deux expressions rendaient la même valeur, donc aucun test de comportement ne peut rougir
   *  dessus — seule leur divergence future le ferait, et ce serait trop tard. Ce qui se vérifie ici
   *  est le nombre de hash que le store calcule lui-même par requête : zéro. Il n'en reprend qu'un,
   *  celui de l'adaptateur.
   *
   *  Les deux formes sont cherchées : l'appel direct à `hashText`, et le détour par `parse(…).hash`
   *  que la première version du garde laissait passer — relevé par la revue du 2026-10-22. */
  test("le store ne calcule aucun hash lui-même", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "store.ts"), "utf8");
    // Les commentaires sont retirés d'abord : un garde qui lit la prose du fichier qu'il surveille
    // se déclenche sur sa propre explication, et c'est le commentaire qu'on finit par réécrire.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const recomputations = [
      ...(code.match(/hashText\s*\(/g) ?? []),
      ...(code.match(/parse\s*\([^)]*\)\s*\.hash/g) ?? []),
    ];
    expect(recomputations).toEqual([]);
  });
});
