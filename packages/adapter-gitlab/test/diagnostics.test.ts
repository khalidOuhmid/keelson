import { describe, expect, test } from "bun:test";
import {
  EXTENDS_CYCLE,
  EXTENDS_TARGET_NOT_FOUND,
  INCLUDE_UNRESOLVED,
  INVALID_YAML,
  JOB_WITHOUT_SCRIPT,
} from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { parse } from "../src/parse.ts";
import { readEdgeCase } from "./support/corpus.ts";

function diagnostic(text: string, code: string) {
  return parse(text).diagnostics.find((candidate) => candidate.code === code);
}

function codes(text: string): string[] {
  return parse(text).diagnostics.map((candidate) => candidate.code);
}

describe("INVALID_YAML", () => {
  test("signale une erreur de syntaxe", () => {
    const found = diagnostic("a:\n  - x\n bad: [1,\n", INVALID_YAML);
    expect(found?.severity).toBe("error");
  });

  test("porte une position dans le texte", () => {
    const text = "a:\n  - x\n bad: [1,\n";
    const found = diagnostic(text, INVALID_YAML);
    expect(found?.range).not.toBeNull();
    if (found?.range != null) {
      expect(found.range.start).toBeGreaterThanOrEqual(0);
      expect(found.range.end).toBeLessThanOrEqual(text.length);
    }
  });

  test("un YAML valide ne déclenche rien", () => {
    expect(codes("a:\n  script: x\n")).not.toContain(INVALID_YAML);
  });

  test("le parsing ne lève jamais d'exception sur un YAML cassé", () => {
    expect(() => parse("{{{\n:::\n- - -\n")).not.toThrow();
    expect(() => parse("\t\tindentation par tabulation\n")).not.toThrow();
  });
});

describe("INCLUDE_UNRESOLVED", () => {
  test("signale la présence d'include en info", () => {
    const found = diagnostic(readEdgeCase("with-include"), INCLUDE_UNRESOLVED);
    expect(found?.severity).toBe("info");
  });

  test("porte la plage de la clé include", () => {
    const text = readEdgeCase("with-include");
    const found = diagnostic(text, INCLUDE_UNRESOLVED);
    if (found?.range != null) {
      expect(text.slice(found.range.start, found.range.end)).toStartWith("include:");
    }
  });

  test("un fichier sans include ne déclenche rien", () => {
    expect(codes(readEdgeCase("flow-needs"))).not.toContain(INCLUDE_UNRESOLVED);
  });
});

describe("EXTENDS_TARGET_NOT_FOUND", () => {
  test("erreur quand le fichier n'a pas d'include", () => {
    expect(diagnostic(readEdgeCase("extends-missing"), EXTENDS_TARGET_NOT_FOUND)?.severity).toBe(
      "error",
    );
  });

  test("avertissement quand le fichier a des include", () => {
    expect(diagnostic(readEdgeCase("with-include"), EXTENDS_TARGET_NOT_FOUND)?.severity).toBe(
      "warning",
    );
  });

  test("nomme la cible manquante", () => {
    const found = diagnostic(readEdgeCase("extends-missing"), EXTENDS_TARGET_NOT_FOUND);
    expect(found?.params).toEqual({ template: ".absent" });
    expect(found === undefined ? "" : renderMessage(found)).toContain(".absent");
  });

  test("n'est pas signalé deux fois pour la même cible", () => {
    const text = [
      "stages:",
      "  - test",
      "",
      "un:",
      "  extends: .absent",
      "  script: a",
      "",
      "deux:",
      "  extends: .absent",
      "  script: b",
      "",
    ].join("\n");
    expect(codes(text).filter((code) => code === EXTENDS_TARGET_NOT_FOUND)).toHaveLength(1);
  });
});

describe("EXTENDS_CYCLE", () => {
  test("signale un cycle en erreur", () => {
    expect(diagnostic(readEdgeCase("extends-cycle"), EXTENDS_CYCLE)?.severity).toBe("error");
  });

  test("un extends vers soi-même est un cycle", () => {
    const text = "stages:\n  - test\n\nmoi:\n  extends: moi\n  script: x\n";
    expect(codes(text)).toContain(EXTENDS_CYCLE);
  });

  test("une chaîne saine ne déclenche rien", () => {
    expect(codes(readEdgeCase("extends-chain"))).not.toContain(EXTENDS_CYCLE);
  });
});

describe("JOB_WITHOUT_SCRIPT", () => {
  const text = readEdgeCase("sans-script");

  test("signale en avertissement un job sans script", () => {
    const found = diagnostic(text, JOB_WITHOUT_SCRIPT);
    expect(found?.severity).toBe("warning");
    expect(found?.params).toEqual({ job: "muet" });
  });

  test("un job avec trigger n'est pas signalé", () => {
    const jobs = parse(text)
      .diagnostics.filter((candidate) => candidate.code === JOB_WITHOUT_SCRIPT)
      .map((candidate) => renderMessage(candidate));
    expect(jobs.some((message) => message.includes("declencheur"))).toBe(false);
  });

  test("un job avec run n'est pas signalé", () => {
    const jobs = parse(text)
      .diagnostics.filter((candidate) => candidate.code === JOB_WITHOUT_SCRIPT)
      .map((candidate) => renderMessage(candidate));
    expect(jobs.some((message) => message.includes("avec-run"))).toBe(false);
  });

  test("est évalué après résolution des extends", () => {
    const inherited = [
      ".avec-script:",
      "  script:",
      "    - echo herite",
      "",
      "stages:",
      "  - test",
      "",
      "herite:",
      "  extends: .avec-script",
      "  stage: test",
      "",
    ].join("\n");
    expect(codes(inherited)).not.toContain(JOB_WITHOUT_SCRIPT);
  });

  test("est évalué après résolution des anchors", () => {
    const anchored = [
      ".base: &base",
      "  script:",
      "    - echo anchor",
      "",
      "boulot:",
      "  <<: *base",
      "",
    ].join("\n");
    expect(codes(anchored)).not.toContain(JOB_WITHOUT_SCRIPT);
  });
});

describe("dédoublonnage par code et params", () => {
  /** Le dédoublonnage portait sur le `message`, qui n'existe plus. S'il s'était contenté du `code`,
   *  deux cibles d'`extends` absentes **différentes** auraient fusionné en un seul diagnostic, et
   *  l'une des deux serait devenue invisible. */
  test("deux cibles d'extends absentes différentes donnent deux diagnostics", () => {
    const text = [
      "stages:",
      "  - test",
      "",
      "un:",
      "  extends: .absent-un",
      "  script: a",
      "",
      "deux:",
      "  extends: .absent-deux",
      "  script: b",
      "",
    ].join("\n");

    const found = parse(text).diagnostics.filter(
      (candidate) => candidate.code === EXTENDS_TARGET_NOT_FOUND,
    );
    expect(found.map((candidate) => candidate.params)).toEqual([
      { template: ".absent-un" },
      { template: ".absent-deux" },
    ]);
  });
});

describe("forme des diagnostics", () => {
  test("aucun diagnostic ne porte de message ni de details", () => {
    const text = [
      "include:",
      "  - template: Jobs/SAST.gitlab-ci.yml",
      "",
      "stages:",
      "  - test",
      "",
      "muet:",
      "  stage: test",
      "",
      "orphelin:",
      "  extends: .absent",
      "  script: a",
      "",
    ].join("\n");

    const found = parse(text).diagnostics;
    expect(found.length).toBeGreaterThan(0);
    for (const candidate of found) {
      expect(Object.keys(candidate).sort()).toEqual(["code", "params", "range", "severity"]);
    }
  });
});

describe("corpus officiel", () => {
  test("aucun template officiel ne produit d'erreur de YAML", () => {
    expect(codes(readEdgeCase("comments"))).not.toContain(INVALID_YAML);
  });
});
