import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isConsumed } from "./consumption.ts";
import { oklchLuminance } from "./oklch.ts";

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
  { reason: "hexadecimal colour", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { reason: "rgb(", pattern: /\brgba?\s*\(/ },
  { reason: "hsl(", pattern: /\bhsla?\s*\(/ },
  { reason: "px value", pattern: /\b\d+(?:\.\d+)?px\b/ },
  // The 2026-10-22 review showed the guard did not see a bare numeric value: a JSX `width="10"`
  // or a geometry constant slipped through silently.
  { reason: "bare rendered size in a JSX attribute", pattern: /\s(?:width|height)="\d/ },
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

describe("no hard-coded design value outside the tokens file", () => {
  test("the tokens file exists and holds the tokens", () => {
    const tokens = readFileSync(join(sourceRoot, TOKENS_FILE), "utf8");
    expect(tokens).toContain("@theme");
    expect(tokens).toContain("--color-surface-0");
    expect(tokens).toContain("--keelson-node-width");
  });

  test("no file in src/ contains a hard-coded design value", () => {
    const offences = scan();
    const report = offences
      .map((offence) => `${offence.file}:${offence.line} ${offence.reason} — ${offence.text}`)
      .join("\n");
    expect(report).toBe("");
  });

  test("the scanner does catch a hexadecimal colour", () => {
    const rule = FORBIDDEN[0];
    expect(rule?.pattern.test("color: #1d4ed8;")).toBe(true);
    expect(rule?.pattern.test("const label = 'build';")).toBe(false);
  });

  test("the scanner does catch rgb, hsl and px", () => {
    expect(FORBIDDEN[1]?.pattern.test("background: rgba(0, 0, 0, 0.4);")).toBe(true);
    expect(FORBIDDEN[2]?.pattern.test("color: hsl(220 10% 50%);")).toBe(true);
    expect(FORBIDDEN[3]?.pattern.test("width: 232px;")).toBe(true);
    expect(FORBIDDEN[3]?.pattern.test("gap: var(--keelson-row-gap);")).toBe(false);
  });

  test("the scanner does cover several files", () => {
    expect(sourceFiles(sourceRoot).length).toBeGreaterThan(3);
  });
});

describe("oklch to WCAG relative luminance", () => {
  /** The contrast guard used to take `L³` as the luminance. Exact for greys, it is optimistic for
   *  chromatic colours: the 2026-10-23 audit measured `danger` on `surface-3` at 3.99:1 in Chromium
   *  where `L³` gave 4.36:1. The conversion is now the exact one: oklch → oklab → linear sRGB. */
  const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  test("white and black are the ends of the scale", () => {
    expect(oklchLuminance("oklch(1 0 0)")).toBeCloseTo(1, 4);
    expect(oklchLuminance("oklch(0 0 0)")).toBeCloseTo(0, 6);
  });

  test("sRGB primaries land on their WCAG coefficients", () => {
    expect(oklchLuminance("oklch(0.62796 0.25768 29.2339)")).toBeCloseTo(0.2126, 3);
    expect(oklchLuminance("oklch(0.86644 0.29483 142.4953)")).toBeCloseTo(0.7152, 3);
    expect(oklchLuminance("oklch(0.45201 0.31321 264.0520)")).toBeCloseTo(0.0722, 3);
  });

  test("danger on surface-3 measures what Chromium renders, not the L³ estimate", () => {
    const danger = oklchLuminance("oklch(0.65 0.19 25)");
    const surface = oklchLuminance("oklch(0.29 0.009 265)");
    expect(Math.round(ratio(danger, surface) * 100) / 100).toBe(3.99);
  });

  test("a colour outside the sRGB gamut is clipped, as the browser renders it", () => {
    expect(oklchLuminance("oklch(0.9 0.4 145)")).toBeLessThanOrEqual(1);
  });

  test("a value that is not oklch is refused", () => {
    expect(() => oklchLuminance("#ffffff")).toThrow();
  });
});

describe("WCAG 2.1 AA contrast", () => {
  /** `PRODUCT.md` commits to WCAG 2.1 AA without reservation, and the surface brief repeats it.
   *  The 2026-10-22 /impeccable audit pass found two failures: `border-default` outlined every
   *  field, select, button, tag and unselected node at 1.63:1 on `surface-1` where 1.4.11 requires
   *  3:1; and `text-muted` on `surface-3` gave 4.03:1 where 1.4.3 requires 4.5:1 — yet `surface-3`
   *  is precisely the background a node takes on hover and selection, so interacting with a node
   *  made its text less readable. This test is the non-regression guard. */
  const TOKENS = new Map(
    [
      ...readFileSync(join(sourceRoot, TOKENS_FILE), "utf8").matchAll(/(--[\w-]+):\s*([^;]+);/g),
    ].map((match) => [match[1] as string, (match[2] as string).trim()]),
  );

  function luminance(token: string): number {
    const value = TOKENS.get(token);
    if (value === undefined) {
      throw new Error(`token missing from tokens.css: ${token}`);
    }
    return oklchLuminance(value);
  }

  function contrast(foreground: string, background: string): number {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (Number(light) + 0.05) / (Number(dark) + 0.05);
  }

  const SURFACES = ["--color-surface-0", "--color-surface-1", "--color-surface-2"];

  describe("1.4.11 — user interface component boundaries, 3:1", () => {
    for (const surface of [...SURFACES, "--color-surface-3"]) {
      test(`border-default on ${surface.replace("--color-", "")}`, () => {
        expect({
          pair: surface,
          ratio: Math.round(contrast("--color-border-default", surface) * 100) / 100,
          meets: contrast("--color-border-default", surface) >= 3,
        }).toMatchObject({ pair: surface, meets: true });
      });
    }

    for (const family of ["build", "test", "operate"]) {
      test(`the ${family} family reads up to surface-3`, () => {
        // A layer label's text and border carry this hue on a selected node: the text threshold
        // is therefore the stricter of the two.
        expect(contrast(`--color-layer-${family}`, "--color-surface-3")).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    }

    test("accent, which carries a selected node's border", () => {
      expect(contrast("--color-accent", "--color-surface-3")).toBeGreaterThanOrEqual(3);
    });
  });

  describe("1.4.3 — text, 4.5:1", () => {
    // `surface-3` is included: it is the background of a hovered or selected node, where
    // `text-muted` carries the stage name.
    for (const surface of [...SURFACES, "--color-surface-3"]) {
      for (const text of ["--color-text-primary", "--color-text-secondary", "--color-text-muted"]) {
        test(`${text.replace("--color-text-", "")} on ${surface.replace("--color-", "")}`, () => {
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

describe("text size floor", () => {
  /** The Impeccable detector rejects functional text below 11px. `--text-2xs: 10px` alone
   *  accounted for 12 of the 14 findings on the page on 2026-10-22, through its 16 call sites. */
  const sizes = [
    ...readFileSync(join(sourceRoot, TOKENS_FILE), "utf8").matchAll(/(--text-[\w-]+):\s*(\d+)px;/g),
  ]
    .filter(([, name]) => name !== undefined && !name.includes("line-height"))
    .map(([, name, value]) => ({ name: name as string, px: Number(value) }));

  test("the ramp is declared", () => {
    expect(sizes.length).toBeGreaterThan(0);
  });

  for (const size of sizes) {
    test(`${size.name} is at least 11px`, () => {
      expect({ token: size.name, px: size.px, meets: size.px >= 11 }).toMatchObject({
        token: size.name,
        meets: true,
      });
    });
  }
});

describe("a token is consumed only by its exact utility class", () => {
  /** The 2026-10-22 review reintroduced six dead tokens: the guard caught five, and let
   *  `--duration-base` through because it searched the stem `base` as a word fragment and found
   *  it in `text-base`. A token is now consumed by its full name, or by a utility class of its own
   *  family whose name ends exactly on the stem. */
  test("a stem shared with another family is not a consumer", () => {
    expect(isConsumed("--duration-base", 'className="text-base"')).toBe(false);
    expect(isConsumed("--text-base", 'className="duration-base"')).toBe(false);
    expect(isConsumed("--radius-lg", 'className="text-lg"')).toBe(false);
    expect(isConsumed("--shadow-md", 'className="rounded-md"')).toBe(false);
  });

  test("a stem inside a longer class name is not a consumer", () => {
    expect(isConsumed("--text-sm", 'className="text-small"')).toBe(false);
    expect(isConsumed("--color-accent", 'className="bg-accent-strong"')).toBe(false);
    expect(isConsumed("--keelson-node-width", "var(--keelson-node-width-strong)")).toBe(false);
  });

  test("a stem in prose is not a consumer", () => {
    expect(isConsumed("--color-accent", "// the accent colour")).toBe(false);
    expect(isConsumed("--tracking-label", 'aria-label="Job"')).toBe(false);
  });

  test("each family is consumed by its own utilities", () => {
    expect(isConsumed("--color-surface-1", 'className="hover:bg-surface-1/50"')).toBe(true);
    expect(isConsumed("--color-border-subtle", 'className="border-b border-border-subtle"')).toBe(
      true,
    );
    expect(isConsumed("--color-accent", 'className="outline-accent"')).toBe(true);
    expect(isConsumed("--text-sm", 'className="text-sm"')).toBe(true);
    expect(isConsumed("--font-weight-semibold", 'className="font-semibold"')).toBe(true);
    expect(isConsumed("--font-mono", 'className="font-mono"')).toBe(true);
    expect(isConsumed("--radius-md", 'className="rounded-t-md"')).toBe(true);
    expect(isConsumed("--duration-fast", 'className="duration-fast"')).toBe(true);
    expect(isConsumed("--ease-out", 'className="ease-out"')).toBe(true);
    expect(isConsumed("--tracking-label", 'className="tracking-label"')).toBe(true);
    expect(isConsumed("--spacing", 'className="gap-2"')).toBe(true);
    expect(isConsumed("--spacing", 'className="-mt-0.5"')).toBe(true);
  });

  test("a token is consumed by its full name", () => {
    expect(isConsumed("--keelson-node-width", "readToken('--keelson-node-width')")).toBe(true);
    expect(isConsumed("--duration-fast", "transition: opacity var(--duration-fast)")).toBe(true);
  });
});

describe("no token promised without a consumer", () => {
  /** `/impeccable document` found eleven tokens defined and never consumed: the file promised a
   *  richer system than what the front end renders. Two of them — the edge widths — were not
   *  hygiene but the reason every edge rendered outside the system. This guard keeps the promise
   *  from forming again. */
  const declared = [
    ...readFileSync(join(sourceRoot, TOKENS_FILE), "utf8").matchAll(/^\s*(--[\w-]+):/gm),
  ].map(([, name]) => name as string);

  const consumers = sourceFiles(sourceRoot)
    .filter((file) => !file.endsWith(TOKENS_FILE))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  /** Tokens Tailwind reads itself, without any class naming them. List them here rather than
   *  weaken the guard: each entry must say which utility consumes it. */
  const IMPLICIT: Record<string, string> = {
    "--default-border-width": "read by Tailwind for the `border` class",
  };

  test("a dead token of each family is caught against the real sources", () => {
    for (const token of [
      "--duration-base",
      "--color-ghost",
      "--text-3xl",
      "--radius-xl",
      "--shadow-md",
      "--font-weight-bold",
      "--keelson-unused-gap",
    ]) {
      expect({ token, consumed: isConsumed(token, consumers) }).toEqual({ token, consumed: false });
    }
  });

  test("the token list is read", () => {
    expect(declared.length).toBeGreaterThan(20);
  });

  test("each implicit exception matches a declared token", () => {
    for (const token of Object.keys(IMPLICIT)) {
      expect({ token, declared: declared.includes(token) }).toEqual({ token, declared: true });
    }
  });

  for (const token of declared.filter((name) => !name.includes("--line-height"))) {
    test(`${token} is consumed`, () => {
      expect({ token, consumed: token in IMPLICIT || isConsumed(token, consumers) }).toEqual({
        token,
        consumed: true,
      });
    });
  }
});

describe("`border-subtle` is never a component boundary", () => {
  /** `DESIGN.md` states it explicitly: "Rule Faint: structural dividers only… it is never a
   *  component boundary". The 2026-10-23 `critique` pass found that L2b had just used it as a job
   *  node's border — measured at 1.26:1 against its column, an object that no longer reads as an
   *  object.
   *
   *  The 1.4.11 guard could not catch it: it only tests `border-default` and `accent`, precisely
   *  because `DESIGN.md` swore that `border-subtle` was never a component border. That promise is
   *  what must be guarded, and it is measured not in contrast but in usage.
   *
   *  The rule adopted: `border-border-subtle` is only valid with a **named side** — `border-b`,
   *  `border-t`, `border-l`, `border-r` — that is, a rule line. A border on all four sides closes
   *  a shape, and closing a shape is the job of `border-default`. */
  const EDGE = /border-(?:[btlr])\b/;

  /** The only exceptions, named rather than left to the luck of matching. A stage column, and the
   *  template column upstream of it, is a **backdrop**, not a component: it must recede behind the
   *  cards it holds, and giving it `border-default` would make the container compete with its
   *  content. The real rule is therefore "a component boundary must be legible", and a column is
   *  not one. The template card itself closes its shape with `border-strong`.
   *
   *  A named exception can be reviewed; a pattern widened to let it through cannot. */
  const BACKDROPS = ["views/pipeline/StageColumnNode.tsx", "views/pipeline/TemplateNode.tsx"];

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

  test("every use is a rule line on a named side, never a closed shape", () => {
    expect(offendingLines()).toEqual([]);
  });

  test("every backdrop in the exception still exists, and does use the token", () => {
    // Without this test, an obsolete entry would stay in the list and hide a future file with
    // the same path.
    for (const name of BACKDROPS) {
      const text = readFileSync(join(sourceRoot, name), "utf8");
      expect({ name, uses: text.includes("border-border-subtle") }).toEqual({ name, uses: true });
    }
  });

  test("the guard does see a closed shape: it recognises a hand-written one", () => {
    // Without this second test, the rule could be an expression that matches nothing and the
    // first test would be green by construction.
    expect(EDGE.test('className="border border-border-subtle rounded-md"')).toBe(false);
    expect(EDGE.test('className="border-b border-border-subtle"')).toBe(true);
  });
});

describe("the label voice is semibold (The Small-Caps Label Rule)", () => {
  /** Uppercase is the label voice and nothing else, and the label voice is 11px semibold. The
   *  `polish` pass of 2026-11-04 found "Writing" and every tag rendered in regular weight. Two
   *  named exceptions keep their documented weight: layer tags (regular, `DESIGN.md` § Chips) and
   *  the Keelson half of the origin badge, whose 500 weight sits on its parent element. */
  const EXCEPTIONS = ["views/coverage/LayerTag.tsx", "views/pipeline/OriginBadge.tsx"];

  function offendingLines(): { file: string; line: number; text: string }[] {
    const found: { file: string; line: number; text: string }[] = [];
    for (const path of sourceFiles(sourceRoot)) {
      const name = relative(sourceRoot, path).split(/[\\/]/).join("/");
      if (EXCEPTIONS.includes(name)) {
        continue;
      }
      for (const [index, text] of readFileSync(path, "utf8").split("\n").entries()) {
        if (/\buppercase\b/.test(text) && !/\bfont-semibold\b/.test(text)) {
          found.push({ file: name, line: index + 1, text: text.trim() });
        }
      }
    }
    return found;
  }

  test("every uppercase class list also sets the semibold weight", () => {
    expect(offendingLines()).toEqual([]);
  });

  test("every exception still sets uppercase, at its own weight", () => {
    for (const name of EXCEPTIONS) {
      const text = readFileSync(join(sourceRoot, name), "utf8");
      expect({ name, uses: /\buppercase\b/.test(text) }).toEqual({ name, uses: true });
    }
  });
});

describe("the layer emphasis ring", () => {
  test("its width comes from a token, not from a bare Tailwind step", () => {
    const node = readFileSync(join(sourceRoot, "views/pipeline/JobNode.tsx"), "utf8");
    expect(node).not.toMatch(/\b(outline|ring)-2\b/);
    expect(node).toContain("ring-[length:var(--keelson-emphasis-width)]");
    const tokens = readFileSync(join(sourceRoot, TOKENS_FILE), "utf8");
    expect(tokens).toMatch(/--keelson-emphasis-width:\s*2px;/);
  });
});
