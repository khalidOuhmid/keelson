import { describe, expect, test } from "bun:test";
import { EXTENDS_CYCLE, EXTENDS_TARGET_NOT_FOUND } from "@keelson/core";
import { parse } from "../src/parse.ts";
import { readEdgeCase } from "./support/corpus.ts";

function job(text: string, id: string) {
  const found = parse(text).pipeline.jobs.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`job « ${id} » absent du pipeline`);
  }
  return found;
}

function codes(text: string): string[] {
  return parse(text).diagnostics.map((diagnostic) => diagnostic.code);
}

describe("chaîne d'extends sur trois niveaux", () => {
  const text = readEdgeCase("extends-chain");

  test("le stage vient du template le plus prioritaire qui le déclare", () => {
    expect(job(text, "final").stage).toEqual({
      value: "test",
      origin: { kind: "extends", template: ".niveau2" },
    });
  });

  test("les needs viennent du template le plus profond qui les déclare", () => {
    const needs = job(text, "final").needs;
    expect(needs?.origin).toEqual({ kind: "extends", template: ".niveau1" });
    expect(needs?.value).toEqual([{ job: "prepare", optional: false, artifacts: true }]);
  });

  test("les maps sont fusionnées en profondeur à travers la chaîne", () => {
    expect(job(text, "final").environment).toEqual({
      value: { name: "niveau2", url: "https://niveau1.example.org" },
      origin: { kind: "extends", template: ".niveau2" },
    });
  });

  test("la liste extends déclarée localement est conservée telle quelle", () => {
    expect(job(text, "final").extends).toEqual([".niveau3"]);
  });

  test("les templates sont collectés à part des jobs", () => {
    const parsed = parse(text);
    expect(parsed.pipeline.templates.map((template) => template.id)).toEqual([
      ".niveau1",
      ".niveau2",
      ".niveau3",
    ]);
    expect(parsed.pipeline.jobs.map((candidate) => candidate.id)).toEqual(["prepare", "final"]);
  });

  test("aucun diagnostic d'extends sur une chaîne saine", () => {
    expect(codes(text)).not.toContain(EXTENDS_TARGET_NOT_FOUND);
    expect(codes(text)).not.toContain(EXTENDS_CYCLE);
  });
});

describe("extends avec plusieurs parents", () => {
  const text = readEdgeCase("extends-multi-parent");

  test("le dernier parent listé l'emporte sur le premier", () => {
    expect(job(text, "gagnant").stage).toEqual({
      value: "test",
      origin: { kind: "extends", template: ".second" },
    });
  });

  test("les clés absentes du dernier parent viennent du premier", () => {
    expect(job(text, "gagnant").environment?.value).toEqual({
      name: "second",
      url: "https://premier.example.org",
    });
  });

  test("la liste extends conserve l'ordre déclaré", () => {
    expect(job(text, "gagnant").extends).toEqual([".premier", ".second"]);
  });
});

describe("valeurs locales prioritaires", () => {
  test("une valeur locale l'emporte sur toute valeur héritée", () => {
    const text = [
      ".base:",
      "  stage: build",
      "",
      "stages:",
      "  - build",
      "  - test",
      "",
      "boulot:",
      "  extends: .base",
      "  stage: test",
      "  script: echo",
      "",
    ].join("\n");
    expect(job(text, "boulot").stage).toEqual({ value: "test", origin: { kind: "local" } });
  });
});

describe("cycle d'extends", () => {
  const text = readEdgeCase("extends-cycle");

  test("signale EXTENDS_CYCLE", () => {
    expect(codes(text)).toContain(EXTENDS_CYCLE);
  });

  test("le diagnostic est une erreur et nomme le chemin", () => {
    const cycle = parse(text).diagnostics.find((diagnostic) => diagnostic.code === EXTENDS_CYCLE);
    expect(cycle?.severity).toBe("error");
    expect(cycle?.params).toEqual({ trail: [".a", ".b", ".a"] });
  });

  test("le parsing aboutit malgré le cycle", () => {
    expect(parse(text).pipeline.jobs.map((candidate) => candidate.id)).toEqual(["boucle"]);
  });
});

describe("cible d'extends absente", () => {
  test("signale EXTENDS_TARGET_NOT_FOUND en erreur sans include", () => {
    const text = readEdgeCase("extends-missing");
    const found = parse(text).diagnostics.find(
      (diagnostic) => diagnostic.code === EXTENDS_TARGET_NOT_FOUND,
    );
    expect(found?.severity).toBe("error");
    expect(found?.params).toEqual({ template: ".absent" });
  });

  test("dégrade en avertissement quand le fichier contient des include", () => {
    const text = readEdgeCase("with-include");
    const found = parse(text).diagnostics.find(
      (diagnostic) => diagnostic.code === EXTENDS_TARGET_NOT_FOUND,
    );
    expect(found?.severity).toBe("warning");
  });
});

describe("anchors et merge <<", () => {
  const text = readEdgeCase("anchors-merge");

  test("une valeur venue d'un anchor porte l'origine anchor", () => {
    expect(job(text, "compile").stage).toEqual({
      value: "build",
      origin: { kind: "anchor", name: "defaults" },
    });
  });

  test("une valeur locale l'emporte sur l'anchor fusionné", () => {
    expect(job(text, "unit").stage).toEqual({ value: "test", origin: { kind: "local" } });
  });

  test("le merge d'une liste d'anchors est résolu", () => {
    expect(job(text, "unit").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
    ]);
  });

  test("les anchors cachés ne sont pas des jobs", () => {
    expect(parse(text).pipeline.jobs.map((candidate) => candidate.id)).toEqual(["compile", "unit"]);
  });
});

describe("!reference", () => {
  const text = readEdgeCase("reference-tag");

  test("résout un !reference local et porte l'origine reference", () => {
    expect(job(text, "unit").needs).toEqual({
      value: [{ job: "compile", optional: false, artifacts: true }],
      origin: { kind: "reference", path: [".needs", "common"] },
    });
  });

  test("le fichier parse sans erreur de YAML", () => {
    expect(parse(text).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("un !reference dans un bloc opaque ne gêne pas le parsing", () => {
    expect(job(text, "compile").opaque.map((block) => block.key)).toContain("script");
  });
});

describe("normalisation des needs", () => {
  const text = readEdgeCase("needs-objects");

  test("les trois formes de need sont normalisées", () => {
    expect(job(text, "unit").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: false },
      { job: "paquet", optional: true, artifacts: true },
      { job: "paquet", optional: false, artifacts: true },
    ]);
  });

  test("le flow style est normalisé comme le block style", () => {
    expect(job(readEdgeCase("flow-needs"), "c").needs?.value).toEqual([
      { job: "a", optional: false, artifacts: true },
      { job: "b", optional: false, artifacts: true },
    ]);
  });

  test("un job sans needs a needs à null", () => {
    expect(job(text, "compile").needs).toBeNull();
  });
});

describe("normalisation de l'environnement", () => {
  const text = readEdgeCase("environment-forms");

  test("une chaîne devient un objet à un seul nom", () => {
    expect(job(text, "chaine").environment?.value).toEqual({ name: "production" });
  });

  test("un objet complet est conservé", () => {
    expect(job(text, "objet").environment?.value).toEqual({
      name: "staging",
      url: "https://staging.example.org",
      action: "start",
    });
  });

  test("une action sans url est conservée", () => {
    expect(job(text, "arret").environment?.value).toEqual({ name: "staging", action: "stop" });
  });

  test("un job sans environnement a environment à null", () => {
    expect(job(readEdgeCase("flow-needs"), "a").environment).toBeNull();
  });
});
