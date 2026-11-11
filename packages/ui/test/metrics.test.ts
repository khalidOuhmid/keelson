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
  test("reads the four metrics from the custom properties", () => {
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

  test("accepts a decimal value", () => {
    setTokens({
      "--keelson-node-width": "232.5px",
      "--keelson-node-height": "64px",
      "--keelson-column-gap": "72px",
      "--keelson-row-gap": "20px",
    });
    expect(readLayoutMetrics().nodeWidth).toBe(232.5);
  });

  test("tolerates whitespace around the value", () => {
    setTokens({
      "--keelson-node-width": "  232px  ",
      "--keelson-node-height": "64px",
      "--keelson-column-gap": "72px",
      "--keelson-row-gap": "20px",
    });
    expect(readLayoutMetrics().nodeWidth).toBe(232);
  });

  test("throws when a token is missing, rather than falling back to a hard-coded value", () => {
    setTokens({ "--keelson-node-width": "232px" });
    expect(() => readLayoutMetrics()).toThrow(/--keelson-node-height/);
  });

  test("throws when a token is not a length", () => {
    setTokens({
      "--keelson-node-width": "large",
      "--keelson-node-height": "64px",
      "--keelson-column-gap": "72px",
      "--keelson-row-gap": "20px",
    });
    expect(() => readLayoutMetrics()).toThrow(/--keelson-node-width/);
  });

  test("token names are the ones in the tokens file", () => {
    expect(Object.values(LAYOUT_TOKENS)).toEqual([
      "--keelson-node-width",
      "--keelson-node-height",
      "--keelson-column-gap",
      "--keelson-row-gap",
    ]);
  });
});
