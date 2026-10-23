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

  /** La clause que ce lot ajoute à la localité. Elle se mesure sur les **octets des fichiers
   *  inclus**, relus du disque après l'opération, et non sur l'intention de l'opération : une
   *  mesure qui se contenterait de vérifier que `touched` ne nomme pas un autre fichier croirait
   *  sur parole le code qu'elle surveille. */
  test("aucune opération ne modifie jamais un fichier inclus", () => {
    fc.assert(
      fc.property(caseArb(), ({ entry, draft }) => {
        run(entry, entry.main, draft);

        for (const file of entry.included) {
          expect({
            file: file.file,
            same: readFileSync(join(entry.root, file.file), "utf8"),
          }).toEqual({ file: file.file, same: file.text });
        }
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
