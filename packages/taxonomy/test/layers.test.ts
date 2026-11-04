import { describe, expect, test } from "bun:test";
import { findLayer, isLayerId, LAYER_IDS, LAYERS } from "../src/index.ts";

describe("taxonomie", () => {
  test("treize couches OWASP et huit catégories plateforme, dans cet ordre", () => {
    const sources = LAYERS.map((layer) => layer.source);
    expect(sources.filter((source) => source === "owasp")).toHaveLength(13);
    expect(sources.filter((source) => source === "platform")).toHaveLength(8);
    expect(sources.lastIndexOf("owasp")).toBeLessThan(sources.indexOf("platform"));
  });

  test("la liste des identifiants et la table disent la même chose", () => {
    expect(LAYERS.map((layer) => layer.id)).toEqual([...LAYER_IDS]);
  });

  test("une couche OWASP cite sa section, une catégorie plateforme n'en cite aucune", () => {
    for (const layer of LAYERS) {
      expect({ id: layer.id, cited: layer.guideline !== null }).toEqual({
        id: layer.id,
        cited: layer.source === "owasp",
      });
    }
  });

  test("les sections citées sont des chemins du dépôt de la Guideline", () => {
    for (const layer of LAYERS.filter((entry) => entry.guideline !== null)) {
      expect(layer.guideline).toStartWith("current-version/");
      expect(layer.guideline).toEndWith(".md");
    }
  });

  test("un résumé par couche, sans doublon", () => {
    const summaries = LAYERS.map((layer) => layer.summary);
    expect(new Set(summaries).size).toBe(LAYERS.length);
    expect(summaries.every((summary) => summary.endsWith("."))).toBe(true);
  });

  test("isLayerId et findLayer", () => {
    expect(isLayerId("sast")).toBe(true);
    expect(isLayerId("inventee")).toBe(false);
    expect(findLayer("sast").name).toBe("Static analysis");
  });
});
