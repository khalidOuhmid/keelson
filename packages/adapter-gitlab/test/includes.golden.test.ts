import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/parse.ts";
import { createFileReader } from "../src/reader.ts";
import { CORPUS_ROOT, type CorpusTree, corpusTrees, readTreeMain } from "./support/corpus.ts";

const trees = corpusTrees();

/** Les arbres passent par le **vrai** lecteur sur disque, pas par un objet littéral : c'est le
 *  seul test qui couvre `createFileReader`, et c'est lui que la CLI et le serveur utilisent. */
function parseTree(tree: CorpusTree) {
  return parse(readTreeMain(tree), { file: tree.main, read: createFileReader(tree.root) });
}

function goldenFor(tree: CorpusTree): unknown {
  const path = join(CORPUS_ROOT, "goldens", "includes", `${tree.name}.expected.ir.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("IR golden du corpus d'includes", () => {
  test("le corpus n'est pas vide", () => {
    expect(trees.length).toBeGreaterThan(5);
  });

  for (const tree of trees) {
    test(tree.name, () => {
      expect(JSON.parse(JSON.stringify(parseTree(tree).pipeline))).toEqual(goldenFor(tree));
    });
  }
});

describe("invariants de l'IR sur les arbres", () => {
  /** L'invariant qui compte quand l'IR devient multi-fichiers : une plage se lit dans le texte de
   *  **son** fichier. La lire dans celui du fichier principal donnerait des octets pris ailleurs —
   *  c'est le défaut que la revue du lot L2 avait trouvé sur le visualiseur de blocs opaques, en
   *  version aggravée, puisque les deux textes n'ont alors aucun rapport. */
  for (const tree of trees) {
    test(`${tree.name} : chaque plage est vraie dans le texte de son fichier`, () => {
      const pipeline = parseTree(tree).pipeline;
      const texts = new Map(
        [...new Set(pipeline.files)].map((file) => [
          file,
          readFileSync(join(tree.root, file), "utf8"),
        ]),
      );

      const textOf = (file: string): string => {
        const text = texts.get(file);
        if (text === undefined) {
          throw new Error(`${tree.name} : ${file} n'est pas dans pipeline.files`);
        }
        return text;
      };

      for (const job of pipeline.jobs) {
        expect(textOf(job.file).slice(job.range.start, job.range.end)).toStartWith(job.id);
        for (const block of job.opaque) {
          expect(textOf(block.file).slice(block.range.start, block.range.end)).toStartWith(
            block.key,
          );
        }
      }

      for (const template of pipeline.templates) {
        expect(textOf(template.file).slice(template.range.start, template.range.end)).toStartWith(
          template.id,
        );
      }

      for (const stage of pipeline.stages) {
        if (stage.range !== null) {
          expect(textOf(stage.file).slice(stage.range.start, stage.range.end)).toBe(stage.name);
        }
      }

      for (const block of pipeline.opaque) {
        expect(textOf(block.file).slice(block.range.start, block.range.end)).toStartWith(block.key);
      }
    });
  }

  test("chaque diagnostic nomme un fichier de l'arbre", () => {
    for (const tree of trees) {
      const parsed = parseTree(tree);
      for (const diagnostic of parsed.diagnostics) {
        expect({
          tree: tree.name,
          code: diagnostic.code,
          known: parsed.pipeline.files.includes(diagnostic.file),
        }).toEqual({ tree: tree.name, code: diagnostic.code, known: true });
      }
    }
  });

  test("le fichier principal est toujours le dernier de l'ordre de fusion", () => {
    for (const tree of trees) {
      const pipeline = parseTree(tree).pipeline;
      expect({ tree: tree.name, last: pipeline.files.at(-1) }).toEqual({
        tree: tree.name,
        last: tree.main,
      });
    }
  });

  test("aucun élément ne nomme un fichier absent de l'ordre de fusion", () => {
    for (const tree of trees) {
      const pipeline = parseTree(tree).pipeline;
      const known = new Set(pipeline.files);
      const named = [
        ...pipeline.jobs.map((job) => job.file),
        ...pipeline.jobs.flatMap((job) => job.opaque.map((block) => block.file)),
        ...pipeline.templates.map((template) => template.file),
        ...pipeline.stages.map((stage) => stage.file),
        ...pipeline.opaque.map((block) => block.file),
      ];
      expect({ tree: tree.name, unknown: named.filter((file) => !known.has(file)) }).toEqual({
        tree: tree.name,
        unknown: [],
      });
    }
  });
});

describe("createFileReader", () => {
  const simple = join(CORPUS_ROOT, "includes", "simple");

  test("lit un fichier de la racine", () => {
    expect(createFileReader(simple).read("ci/jobs.yml")).toContain("compile:");
  });

  /** La seconde barrière, après `normaliseIncludePath`. Elle est redondante par choix : c'est la
   *  dernière ligne avant un `readFileSync` déclenché par le fichier d'un dépôt quelconque, lu par
   *  un serveur qui répond à une page web. Le chemin testé ici est **déjà normalisé**, donc il ne
   *  passe pas par le premier contrôle — c'est bien celle-ci qu'il mesure. */
  test("refuse un chemin qui sort de la racine, même déjà normalisé", () => {
    const reader = createFileReader(simple);
    expect(reader.read("../override/ci/jobs.yml")).toBeNull();
    expect(reader.read("/etc/passwd")).toBeNull();
  });

  test("un fichier absent rend null plutôt que de lever", () => {
    expect(createFileReader(simple).read("ci/absent.yml")).toBeNull();
  });

  test("candidates ne rend que des fichiers YAML, chemins relatifs à la racine", () => {
    const found = createFileReader(join(CORPUS_ROOT, "includes", "wildcard")).candidates();
    expect([...found].sort()).toEqual([
      ".gitlab-ci.yml",
      "configs/a.yml",
      "configs/b.yml",
      "configs/sous/z.yml",
    ]);
  });
});
