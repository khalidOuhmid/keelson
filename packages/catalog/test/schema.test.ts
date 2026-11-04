import { describe, expect, test } from "bun:test";
import { isOpenSource, lintCatalog, parseTool, type Tool } from "../src/index.ts";

const VALID = `id: outil
name: Outil
kind: job
layers: [sast]
license: MIT
homepage: https://exemple.org
verifiedAt: https://exemple.org/docs
logo: null
detect:
  images: [exemple/outil]
  scripts: ['\\boutil\\b']
snippets:
  gitlab: null
  github: |
    - run: outil
lastVerified: 2026-11-04
`;

const NOW = new Date("2026-11-04T00:00:00Z");

function codes(text: string, logos = {}, now = NOW): string[] {
  return lintCatalog([{ file: "outil.yaml", text }], logos, now).map((entry) => entry.code);
}

describe("schéma d'une fiche", () => {
  test("une fiche valide passe", () => {
    expect(parseTool(VALID).ok).toBe(true);
    expect(codes(VALID)).toEqual([]);
  });

  test.each([
    ["une couche inconnue", "layers: [sast]", "layers: [inventee]", "layers.0"],
    ["une licence inconnue", "license: MIT", "license: WTFPL", "license"],
    ["un identifiant en capitales", "id: outil", "id: Outil", "id"],
    ["une date invalide", "lastVerified: 2026-11-04", "lastVerified: hier", "lastVerified"],
    ["une URL invalide", "homepage: https://exemple.org", "homepage: exemple", "homepage"],
    ["une regex invalide", "'\\boutil\\b'", "'('", "detect.scripts.0"],
    ["un champ inconnu", "kind: job", "kind: job\nextra: 1", ""],
  ])("refuse %s", (_label, from, to, path) => {
    const parsed = parseTool(VALID.replace(from, to));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.detail).toContain(path);
  });

  test("un YAML illisible rend un détail et ne lève pas", () => {
    expect(parseTool("a: [").ok).toBe(false);
  });
});

describe("lint du catalogue", () => {
  test("une fiche invalide est une erreur nommée", () => {
    expect(codes("id: X")).toEqual(["CATALOG_INVALID_TOOL"]);
  });

  test("un logo absent du catalogue est une erreur", () => {
    const text = VALID.replace("logo: null", "logo: inconnu");
    expect(codes(text)).toEqual(["CATALOG_UNKNOWN_LOGO"]);
    expect(codes(text, { inconnu: { path: "M0 0" } })).toEqual([]);
  });

  test("un outil job sans aucun snippet est une erreur, pas un service", () => {
    const empty = VALID.replace("github: |\n    - run: outil", "github: null");
    expect(codes(empty)).toEqual(["CATALOG_MISSING_SNIPPET"]);
    expect(codes(empty.replace("kind: job", "kind: service"))).toEqual([]);
  });

  test("un doublon d'identifiant est une erreur", () => {
    const found = lintCatalog(
      [
        { file: "a.yaml", text: VALID },
        { file: "b.yaml", text: VALID },
      ],
      {},
      NOW,
    );
    expect(found.map((entry) => [entry.code, entry.file])).toEqual([
      ["CATALOG_DUPLICATE_TOOL", "b.yaml"],
    ]);
  });

  test("la fraîcheur bascule à six mois exactement, en avertissement", () => {
    const aged = VALID.replace("lastVerified: 2026-11-04", "lastVerified: 2026-05-04");
    expect(codes(aged)).toEqual([]);
    const older = VALID.replace("lastVerified: 2026-11-04", "lastVerified: 2026-05-03");
    const found = lintCatalog([{ file: "o.yaml", text: older }], {}, NOW);
    expect(found.map((entry) => [entry.code, entry.severity])).toEqual([
      ["CATALOG_STALE_TOOL", "warning"],
    ]);
  });
});

describe("licences", () => {
  test("seules les licences open source comptent comme telles", () => {
    const of = (license: Tool["license"]) => isOpenSource({ license });
    expect(of("MIT")).toBe(true);
    expect(of("AGPL-3.0-only")).toBe(true);
    expect(of("BUSL-1.1")).toBe(false);
    expect(of("FSL-1.1-Apache-2.0")).toBe(false);
    expect(of("Proprietary")).toBe(false);
  });
});

describe("les snippets sont vérifiés au parse", () => {
  test.each([
    ["un GitLab illisible", "gitlab: null", 'gitlab: "a: ["', "snippets.gitlab"],
    ["un GitLab qui n'est pas une map", "gitlab: null", 'gitlab: "- a"', "snippets.gitlab"],
    [
      "un GitHub qui n'est pas une liste",
      "github: |\n    - run: outil",
      'github: "a: b"',
      "snippets.github",
    ],
  ])("refuse %s", (_label, from, to, path) => {
    const parsed = parseTool(VALID.replace(from, to));
    expect(parsed.ok ? "" : parsed.detail).toContain(path);
    expect(parsed.ok).toBe(false);
  });
});
