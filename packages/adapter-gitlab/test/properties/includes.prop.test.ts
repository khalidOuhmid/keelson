import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashText, type Operation } from "@keelson/core";
import fc from "fast-check";
import { apply } from "../../src/apply.ts";
import { GITLAB_CI_FILE, parse } from "../../src/parse.ts";
import { createFileReader } from "../../src/reader.ts";
import { corpusTrees, readTreeMain } from "../support/corpus.ts";
import { assertOptions, operationArb } from "./support/arbitraries.ts";

const trees = corpusTrees();

type Case = {
  name: string;
  root: string;
  main: string;
  /** Les octets de chaque fichier inclus, lus **avant** toute opération. */
  included: { file: string; text: string }[];
};

const cases: Case[] = trees.map((tree) => {
  const main = readTreeMain(tree);
  const pipeline = parse(main, {
    file: tree.main,
    read: createFileReader(tree.root),
  }).pipeline;

  return {
    name: tree.name,
    root: tree.root,
    main,
    included: [...new Set(pipeline.files)]
      .filter((file) => file !== tree.main)
      .map((file) => ({ file, text: readFileSync(join(tree.root, file), "utf8") })),
  };
});

function parseCase(entry: Case, text: string) {
  return parse(text, { file: GITLAB_CI_FILE, read: createFileReader(entry.root) });
}

function caseArb(): fc.Arbitrary<{ entry: Case; draft: unknown }> {
  return fc.constantFrom(...cases).chain((entry) =>
    operationArb(entry.main, parseCase(entry, entry.main).pipeline).map((draft) => ({
      entry,
      draft,
    })),
  );
}

function run(entry: Case, text: string, draft: unknown) {
  const operation = { v: 1, baseHash: hashText(text), ...(draft as object) } as Operation;
  return apply(parseCase(entry, text).document, operation);
}

describe("propriétés sur les arbres multi-fichiers", () => {
  test("le corpus d'arbres est bien celui qui nourrit ces propriétés", () => {
    expect(cases.length).toBe(trees.length);
    expect(cases.some((entry) => entry.included.length > 0)).toBe(true);
  });

  /** La clause que ce lot ajoute à la localité, et **ce qu'elle peut mesurer ici**. `apply` est
   *  une fonction pure : relire les fichiers du disque après l'appel ne dit rien, parce que rien
   *  ne les écrit jamais — la revue indépendante du 2026-10-23 l'a prouvé en neutralisant tous les
   *  refus `FROM_INCLUDED_FILE` sans faire rougir ce fichier.
   *
   *  Ce qui est mesurable sur une fonction pure est que son résultat ne prétend rien avoir changé
   *  ailleurs : `included` revient identique pour chaque opération tirée. La garantie sur les
   *  octets du disque est mesurée là où une écriture a lieu, dans
   *  `packages/server/test/includes.test.ts`. */
  test("aucune opération ne prétend avoir changé un fichier inclus", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }

        const before = Object.fromEntries(entry.included.map((file) => [file.file, file.text]));
        expect(result.value.included).toEqual(before);
      }),
      assertOptions(),
    );
  });

  test("aller-retour : l'inverse restaure les octets du fichier principal", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }
        const back = apply(result.value.document, result.value.inverse);
        if (!back.ok) {
          throw new Error(`inverse refusé : ${back.error.code}`);
        }
        expect(back.value.text).toBe(entry.main);
      }),
      assertOptions(),
    );
  });

  test("déterminisme : deux applications de la même opération rendent le même texte", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const first = run(entry, entry.main, draft);
        const second = run(entry, entry.main, draft);
        expect(first.ok).toBe(second.ok);
        if (first.ok && second.ok) {
          expect(first.value.text).toBe(second.value.text);
        }
      }),
      assertOptions(),
    );
  });

  test("localité : le préfixe avant la première plage touchée est intact", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }
        const first = result.value.touched[0];
        if (first === undefined) {
          expect(result.value.text).toBe(entry.main);
          return;
        }
        expect(result.value.text.slice(0, first.start)).toBe(entry.main.slice(0, first.start));
      }),
      assertOptions(),
    );
  });

  /** Sans cette propriété, une opération acceptée pourrait rendre un pipeline amputé de ses jobs
   *  inclus — c'est ce qui arrivait quand `apply` relisait le texte sans son lecteur d'includes. */
  test("un pipeline rendu après une opération garde tous les fichiers de l'arbre", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        const result = run(entry, entry.main, draft);
        if (!result.ok) {
          return;
        }
        const before = parseCase(entry, entry.main).pipeline.files;
        expect(result.value.pipeline.files).toEqual(before);
      }),
      assertOptions(),
    );
  });
});
