import { describe, expect, test } from "bun:test";
import { findLayer, isLayerId, LAYER_IDS, LAYERS } from "../src/index.ts";

describe("taxonomy", () => {
  test("thirteen OWASP layers and eight platform categories, in this order", () => {
    const sources = LAYERS.map((layer) => layer.source);
    expect(sources.filter((source) => source === "owasp")).toHaveLength(13);
    expect(sources.filter((source) => source === "platform")).toHaveLength(8);
    expect(sources.lastIndexOf("owasp")).toBeLessThan(sources.indexOf("platform"));
  });

  test("the id list and the table say the same thing", () => {
    expect(LAYERS.map((layer) => layer.id)).toEqual([...LAYER_IDS]);
  });

  test("an OWASP layer cites its section, a platform category cites none", () => {
    for (const layer of LAYERS) {
      expect({ id: layer.id, cited: layer.guideline !== null }).toEqual({
        id: layer.id,
        cited: layer.source === "owasp",
      });
    }
  });

  test("cited sections are paths in the Guideline repository", () => {
    for (const layer of LAYERS.filter((entry) => entry.guideline !== null)) {
      expect(layer.guideline).toStartWith("current-version/");
      expect(layer.guideline).toEndWith(".md");
    }
  });

  test("one summary per layer, without duplicates", () => {
    const summaries = LAYERS.map((layer) => layer.summary);
    expect(new Set(summaries).size).toBe(LAYERS.length);
    expect(summaries.every((summary) => summary.endsWith("."))).toBe(true);
  });

  test("a unique short label per layer: it is the word that names the colour", () => {
    const shorts = LAYERS.map((layer) => layer.short);
    expect(new Set(shorts).size).toBe(LAYERS.length);
  });

  test("the platform family is exactly the platform source", () => {
    for (const layer of LAYERS) {
      expect({ id: layer.id, platform: layer.family === "platform" }).toEqual({
        id: layer.id,
        platform: layer.source === "platform",
      });
    }
  });

  test("isLayerId and findLayer", () => {
    expect(isLayerId("sast")).toBe(true);
    expect(isLayerId("inventee")).toBe(false);
    expect(findLayer("sast").name).toBe("Static analysis");
  });
});
