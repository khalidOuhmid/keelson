const SIDE = "(?:-(?:x|y|s|e|t|r|b|l|ss|se|es|ee|tl|tr|br|bl))?";

/** Each Tailwind theme namespace, with the utility prefixes that consume it. The longest namespace
 *  comes first: `--font-weight-semibold` belongs to `font-weight`, not to `font`. */
const FAMILIES: { namespace: string; utilities: string }[] = [
  {
    namespace: "color",
    utilities: `(?:bg|text|border${SIDE}|divide|outline|ring|ring-offset|inset-ring|shadow|inset-shadow|fill|stroke|caret|accent|decoration|placeholder|from|via|to)`,
  },
  { namespace: "font-weight", utilities: "font" },
  { namespace: "border-width", utilities: `border${SIDE}` },
  { namespace: "line-height", utilities: "leading" },
  { namespace: "text", utilities: "text" },
  { namespace: "font", utilities: "font" },
  { namespace: "radius", utilities: `rounded${SIDE}` },
  { namespace: "duration", utilities: "duration" },
  { namespace: "ease", utilities: "ease" },
  { namespace: "tracking", utilities: "tracking" },
  { namespace: "shadow", utilities: "shadow" },
];

const SPACING_UTILITIES =
  "(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-[wh]|max-[wh]|inset(?:-[xy])?|top|right|bottom|left|translate-[xy]|scroll-[mp][xytrblse]?)";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bounded(pattern: string): RegExp {
  return new RegExp(`(?<![\\w-])${pattern}(?![\\w-])`);
}

/** A token is consumed by its full name — `var(--x)`, a string read at runtime — or by a utility
 *  class of its own family whose name ends exactly on the token's stem. */
export function isConsumed(token: string, consumers: string): boolean {
  if (bounded(escapeRegExp(token)).test(consumers)) {
    return true;
  }
  if (token === "--spacing") {
    return bounded(`-?${SPACING_UTILITIES}-\\d+(?:\\.\\d+)?`).test(consumers);
  }
  const family = FAMILIES.find(({ namespace }) => token.startsWith(`--${namespace}-`));
  if (family === undefined) {
    return false;
  }
  const stem = token.slice(`--${family.namespace}-`.length);
  return bounded(`${family.utilities}-${escapeRegExp(stem)}`).test(consumers);
}
