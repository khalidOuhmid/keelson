import type { LayoutMetrics } from "./layout.ts";

export const LAYOUT_TOKENS = {
  nodeWidth: "--keelson-node-width",
  nodeHeight: "--keelson-node-height",
  columnGap: "--keelson-column-gap",
  rowGap: "--keelson-row-gap",
} as const satisfies Record<keyof LayoutMetrics, string>;

function length(styles: CSSStyleDeclaration, token: string): number {
  const raw = styles.getPropertyValue(token).trim();
  const parsed = Number.parseFloat(raw);
  if (raw === "" || Number.isNaN(parsed)) {
    throw new Error(`token de mise en page absent ou illisible : ${token}`);
  }
  return parsed;
}

export const COLUMN_HEADER_TOKEN = "--keelson-column-header-height";
export const COLUMN_PADDING_TOKEN = "--keelson-column-padding";

/** Lit un token de longueur en rendant 0 s'il est absent : contrairement aux métriques passées à
 *  elkjs, une marge manquante dégrade le rendu sans le rendre faux. */
function optionalLength(token: string, element?: Element): number {
  const raw = getComputedStyle(element ?? document.documentElement)
    .getPropertyValue(token)
    .trim();
  const parsed = Number.parseFloat(raw);
  return raw === "" || Number.isNaN(parsed) ? 0 : parsed;
}

export function readColumnPadding(element?: Element): number {
  return optionalLength(COLUMN_PADDING_TOKEN, element);
}

export function readColumnHeaderHeight(element?: Element): number {
  return optionalLength(COLUMN_HEADER_TOKEN, element);
}

export function readLayoutMetrics(element?: Element): LayoutMetrics {
  const target = element ?? document.documentElement;
  const styles = getComputedStyle(target);

  return {
    nodeWidth: length(styles, LAYOUT_TOKENS.nodeWidth),
    nodeHeight: length(styles, LAYOUT_TOKENS.nodeHeight),
    columnGap: length(styles, LAYOUT_TOKENS.columnGap),
    rowGap: length(styles, LAYOUT_TOKENS.rowGap),
  };
}
