import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(packageRoot, "src");
export const TOKENS_FILE = "tokens.css";

type Offence = {
  file: string;
  line: number;
  text: string;
  reason: string;
};

const FORBIDDEN: { reason: string; pattern: RegExp }[] = [
  { reason: "couleur hexadécimale", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { reason: "rgb(", pattern: /\brgba?\s*\(/ },
  { reason: "hsl(", pattern: /\bhsla?\s*\(/ },
  { reason: "valeur en px", pattern: /\b\d+(?:\.\d+)?px\b/ },
  // La revue du 2026-10-22 a montre que le garde ne voyait pas une valeur numerique nue : un
  // `width="10"` en JSX ou une constante de geometrie passaient sans bruit.
  { reason: "taille rendue nue en attribut JSX", pattern: /\s(?:width|height)="\d/ },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

function scan(): Offence[] {
  const offences: Offence[] = [];

  for (const path of sourceFiles(sourceRoot)) {
    const name = relative(sourceRoot, path).split(/[\\/]/).join("/");
    if (name === TOKENS_FILE) {
      continue;
    }

    for (const [index, text] of readFileSync(path, "utf8").split("\n").entries()) {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(text)) {
          offences.push({ file: name, line: index + 1, text: text.trim(), reason: rule.reason });
        }
      }
    }
  }

  return offences;
}

describe("aucune valeur de design en dur hors du fichier de tokens", () => {
  test("le fichier de tokens existe et porte les tokens", () => {
    const tokens = readFileSync(join(sourceRoot, TOKENS_FILE), "utf8");
    expect(tokens).toContain("@theme");
    expect(tokens).toContain("--color-surface-0");
    expect(tokens).toContain("--keelson-node-width");
  });

  test("aucun fichier de src/ ne contient de valeur de design en dur", () => {
    const offences = scan();
    const report = offences
      .map((offence) => `${offence.file}:${offence.line} ${offence.reason} — ${offence.text}`)
      .join("\n");
    expect(report).toBe("");
  });

  test("le scanner repère bien une couleur hexadécimale", () => {
    const rule = FORBIDDEN[0];
    expect(rule?.pattern.test("color: #1d4ed8;")).toBe(true);
    expect(rule?.pattern.test("const label = 'build';")).toBe(false);
  });

  test("le scanner repère bien rgb, hsl et px", () => {
    expect(FORBIDDEN[1]?.pattern.test("background: rgba(0, 0, 0, 0.4);")).toBe(true);
    expect(FORBIDDEN[2]?.pattern.test("color: hsl(220 10% 50%);")).toBe(true);
    expect(FORBIDDEN[3]?.pattern.test("width: 232px;")).toBe(true);
    expect(FORBIDDEN[3]?.pattern.test("gap: var(--keelson-row-gap);")).toBe(false);
  });

  test("le scanner couvre bien plusieurs fichiers", () => {
    expect(sourceFiles(sourceRoot).length).toBeGreaterThan(3);
  });
});

describe("contraste WCAG 2.1 AA", () => {
  /** `PRODUCT.md` engage WCAG 2.1 AA sans réserve, et le surface brief le répète. La passe
   *  /impeccable audit du 2026-10-22 a trouvé deux manquements : `border-default` bordait chaque
   *  champ, select, bouton, tag et nœud non sélectionné à 1,63:1 sur `surface-1` quand 1.4.11 exige
   *  3:1 ; et `text-muted` sur `surface-3` donnait 4,03:1 quand 1.4.3 exige 4,5:1 — or `surface-3`
   *  est précisément le fond qu'un nœud prend au survol et à la sélection, de sorte qu'interagir
   *  avec un nœud rendait son texte moins lisible. Ce test est le garde de non-régression. */
  const TOKENS = new Map(
    [
      ...readFileSync(join(sourceRoot, TOKENS_FILE), "utf8").matchAll(/(--[\w-]+):\s*([^;]+);/g),
    ].map((match) => [match[1] as string, (match[2] as string).trim()]),
  );

  /** Oklch achromatique : la luminance relative suit L³ d'assez près pour un garde de rampe. */
  function luminance(token: string): number {
    const value = TOKENS.get(token);
    if (value === undefined) {
      throw new Error(`token absent de tokens.css : ${token}`);
    }
    const lightness = /oklch\(\s*([\d.]+)/.exec(value)?.[1];
    if (lightness === undefined) {
      throw new Error(`${token} n'est pas une couleur oklch : ${value}`);
    }
    return Number(lightness) ** 3;
  }

  function contrast(foreground: string, background: string): number {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (Number(light) + 0.05) / (Number(dark) + 0.05);
  }

  const SURFACES = ["--color-surface-0", "--color-surface-1", "--color-surface-2"];

  describe("1.4.11 — limites des composants d'interface, 3:1", () => {
    for (const surface of [...SURFACES, "--color-surface-3"]) {
      test(`border-default sur ${surface.replace("--color-", "")}`, () => {
        expect({
          pair: surface,
          ratio: Math.round(contrast("--color-border-default", surface) * 100) / 100,
          meets: contrast("--color-border-default", surface) >= 3,
        }).toMatchObject({ pair: surface, meets: true });
      });
    }

    test("accent, qui porte la bordure d'un nœud sélectionné", () => {
      expect(contrast("--color-accent", "--color-surface-3")).toBeGreaterThanOrEqual(3);
    });
  });

  describe("1.4.3 — texte, 4,5:1", () => {
    // `surface-3` est inclus : c'est le fond d'un nœud survolé ou sélectionné, où `text-muted`
    // porte le nom du stage.
    for (const surface of [...SURFACES, "--color-surface-3"]) {
      for (const text of ["--color-text-primary", "--color-text-secondary", "--color-text-muted"]) {
        test(`${text.replace("--color-text-", "")} sur ${surface.replace("--color-", "")}`, () => {
          expect({
            pair: `${text} / ${surface}`,
            ratio: Math.round(contrast(text, surface) * 100) / 100,
            meets: contrast(text, surface) >= 4.5,
          }).toMatchObject({ pair: `${text} / ${surface}`, meets: true });
        });
      }
    }
  });
});

describe("plancher de taille de texte", () => {
  /** Le détecteur Impeccable refuse le texte fonctionnel sous 11px. `--text-2xs: 10px` expliquait
   *  à lui seul 12 des 14 constats relevés en page le 2026-10-22, par ses 16 points d'appel. */
  const sizes = [
    ...readFileSync(join(sourceRoot, TOKENS_FILE), "utf8").matchAll(/(--text-[\w-]+):\s*(\d+)px;/g),
  ]
    .filter(([, name]) => name !== undefined && !name.includes("line-height"))
    .map(([, name, value]) => ({ name: name as string, px: Number(value) }));

  test("la rampe est déclarée", () => {
    expect(sizes.length).toBeGreaterThan(0);
  });

  for (const size of sizes) {
    test(`${size.name} est au moins à 11px`, () => {
      expect({ token: size.name, px: size.px, meets: size.px >= 11 }).toMatchObject({
        token: size.name,
        meets: true,
      });
    });
  }
});

describe("aucun token promis sans consommateur", () => {
  /** `/impeccable document` relevait onze tokens définis et jamais consommés : le fichier promettait
   *  un système plus riche que ce que le front rend. Deux d'entre eux — les épaisseurs d'arête —
   *  n'étaient pas de l'hygiène mais la raison pour laquelle chaque arête rendait hors système.
   *  Ce garde empêche la promesse de se reformer. */
  const declared = [
    ...readFileSync(join(sourceRoot, TOKENS_FILE), "utf8").matchAll(/^\s*(--[\w-]+):/gm),
  ].map(([, name]) => name as string);

  const consumers = sourceFiles(sourceRoot)
    .filter((file) => !file.endsWith(TOKENS_FILE))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  /** Tailwind consomme `--color-surface-1` sous la forme `bg-surface-1`, et `--text-sm` sous la
   *  forme `text-sm` : on cherche la racine du token autant que son nom complet. */
  /** Tokens que Tailwind lit lui-même, sans qu'aucune classe ne les nomme. Les lister ici plutôt
   *  que d'affaiblir le garde : chaque entrée doit dire par quelle utilitaire elle est consommée. */
  const IMPLICIT: Record<string, string> = {
    "--default-border-width": "lu par Tailwind pour la classe `border`",
  };

  function isConsumed(token: string): boolean {
    if (token in IMPLICIT) {
      return true;
    }
    if (consumers.includes(token)) {
      return true;
    }
    // `--font-weight-semibold` se consomme en `font-semibold`, `--border-width-hairline` en
    // `border-hairline` : la famille du token disparaît de la classe utilitaire.
    const stems = [
      token.replace(/^--(color|text|font|radius|duration|shadow|tracking|ease|spacing)-?/, ""),
      token.replace(/^--(font-weight|border-width|line-height)-/, ""),
      token.replace(/^--/, ""),
    ].filter((stem) => stem !== "");

    return stems.some((stem) =>
      new RegExp(`\\b[\\w-]*${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(consumers),
    );
  }

  test("la liste des tokens est lue", () => {
    expect(declared.length).toBeGreaterThan(20);
  });

  test("chaque exception implicite correspond à un token déclaré", () => {
    for (const token of Object.keys(IMPLICIT)) {
      expect({ token, declared: declared.includes(token) }).toEqual({ token, declared: true });
    }
  });

  for (const token of declared.filter((name) => !name.includes("--line-height"))) {
    test(`${token} est consommé`, () => {
      expect({ token, consumed: isConsumed(token) }).toEqual({ token, consumed: true });
    });
  }
});

describe("`border-subtle` n'est jamais une limite de composant", () => {
  /** `DESIGN.md` l'énonce nommément : « Rule Faint : structural dividers only… it is never a
   *  component boundary ». La passe `critique` du 2026-10-23 a trouvé que L2b venait de
   *  l'employer comme bordure d'un nœud de job — mesurée à 1,26:1 contre sa colonne, soit un
   *  objet qui ne se lit plus comme un objet.
   *
   *  Le garde de 1.4.11 ne pouvait pas l'attraper : il ne teste que `border-default` et `accent`,
   *  précisément parce que `DESIGN.md` jurait que `border-subtle` n'était jamais une bordure de
   *  composant. C'est cette promesse-là qu'il faut garder, et elle ne se mesure pas en contraste
   *  mais sur l'usage.
   *
   *  La règle retenue : `border-border-subtle` ne vaut qu'avec une **arête nommée** —
   *  `border-b`, `border-t`, `border-l`, `border-r` —, c'est-à-dire un filet. Une bordure sur les
   *  quatre côtés ferme une forme, et fermer une forme est le rôle de `border-default`. */
  const EDGE = /border-(?:[btlr])\b/;

  /** La seule exception, nommée plutôt que laissée au hasard de la correspondance. Une colonne de
   *  stage est un **fond**, pas un composant : elle doit s'effacer derrière les cartes de job
   *  qu'elle contient, et lui donner `border-default` ferait concurrencer le conteneur à son
   *  contenu. La règle réelle est donc « une limite de composant doit être lisible », et une
   *  colonne n'en est pas une.
   *
   *  Une exception nommée se relit ; un motif élargi pour la faire passer ne se relit pas. */
  const BACKDROPS = ["views/pipeline/StageColumnNode.tsx"];

  function offendingLines(): { file: string; line: number; text: string }[] {
    const found: { file: string; line: number; text: string }[] = [];

    for (const path of sourceFiles(sourceRoot)) {
      const name = relative(sourceRoot, path).split(/[\\/]/).join("/");
      if (name === TOKENS_FILE) {
        continue;
      }
      for (const [index, text] of readFileSync(path, "utf8").split("\n").entries()) {
        if (
          text.includes("border-border-subtle") &&
          !EDGE.test(text) &&
          !BACKDROPS.includes(name)
        ) {
          found.push({ file: name, line: index + 1, text: text.trim() });
        }
      }
    }

    return found;
  }

  test("chaque usage est un filet sur une arête nommée, jamais une forme fermée", () => {
    expect(offendingLines()).toEqual([]);
  });

  test("chaque fond de l'exception existe encore, et emploie bien le token", () => {
    // Sans ce test, une entrée devenue obsolète resterait dans la liste et y masquerait un
    // fichier futur qui porterait le même chemin.
    for (const name of BACKDROPS) {
      const text = readFileSync(join(sourceRoot, name), "utf8");
      expect({ name, uses: text.includes("border-border-subtle") }).toEqual({ name, uses: true });
    }
  });

  test("le garde voit bien une forme fermée : il en reconnaît une écrite à la main", () => {
    // Sans ce second test, la règle pourrait être une expression qui ne correspond à rien et le
    // premier test serait vert par construction.
    expect(EDGE.test('className="border border-border-subtle rounded-md"')).toBe(false);
    expect(EDGE.test('className="border-b border-border-subtle"')).toBe(true);
  });
});
