import { beforeEach, describe, expect, test } from "bun:test";
import { LAYOUT_TOKENS, readLayoutMetrics } from "../src/views/pipeline/metrics.ts";

function setTokens(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    document.documentElement.style.setProperty(name, value);
  }
}

function clearTokens(): void {
  for (const name of Object.values(LAYOUT_TOKENS)) {
    document.documentElement.style.removeProperty(name);
  }
}

beforeEach(clearTokens);

describe("readLayoutMetrics", () => {
  test("lit les quatre métriques depuis les propriétés personnalisées", () => {
    setTokens({
      "--keelson-node-width": "232px",
      "--keelson-node-height": "64px",
      "--keelson-column-gap": "72px",
      "--keelson-row-gap": "20px",
    });

    expect(readLayoutMetrics()).toEqual({
      nodeWidth: 232,
      nodeHeight: 64,
      columnGap: 72,
      rowGap: 20,
    });
  });

  test("accepte une valeur décimale", () => {
    setTokens({
      "--keelson-node-width": "232.5px",
      "--keelson-node-height": "64px",
      "--keelson-column-gap": "72px",
      "--keelson-row-gap": "20px",
    });
    expect(readLayoutMetrics().nodeWidth).toBe(232.5);
  });

  test("tolère les espaces autour de la valeur", () => {
    setTokens({
      "--keelson-node-width": "  232px  ",
      "--keelson-node-height": "64px",
      "--keelson-column-gap": "72px",
      "--keelson-row-gap": "20px",
    });
    expect(readLayoutMetrics().nodeWidth).toBe(232);
  });

  test("lève quand un token manque, plutôt que de retomber sur une valeur en dur", () => {
    setTokens({ "--keelson-node-width": "232px" });
    expect(() => readLayoutMetrics()).toThrow(/--keelson-node-height/);
  });

  test("lève quand un token n'est pas une longueur", () => {
    setTokens({
      "--keelson-node-width": "large",
      "--keelson-node-height": "64px",
      "--keelson-column-gap": "72px",
      "--keelson-row-gap": "20px",
    });
    expect(() => readLayoutMetrics()).toThrow(/--keelson-node-width/);
  });

  test("les noms de tokens sont ceux du fichier de tokens", () => {
    expect(Object.values(LAYOUT_TOKENS)).toEqual([
      "--keelson-node-width",
      "--keelson-node-height",
      "--keelson-column-gap",
      "--keelson-row-gap",
    ]);
  });
});
