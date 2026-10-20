import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { COMMANDS, run } from "../src/run.ts";

describe("--version", () => {
  test("affiche la version du package.json et sort en 0", () => {
    const result = run(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("accepte -v", () => {
    expect(run(["-v"]).stdout.trim()).toBe(packageJson.version);
  });
});

describe("--help", () => {
  test("liste les commandes prévues et sort en 0", () => {
    const result = run(["--help"]);
    expect(result.exitCode).toBe(0);
    for (const command of ["start", "validate", "coverage", "export"]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("accepte -h", () => {
    expect(run(["-h"]).exitCode).toBe(0);
  });
});

describe("commandes", () => {
  test("COMMANDS déclare les quatre commandes prévues", () => {
    expect(COMMANDS).toEqual(["start", "validate", "coverage", "export"]);
  });

  for (const command of ["start", "coverage", "export"]) {
    test(`${command} répond « pas encore implémentée » et sort en 2`, () => {
      const result = run([command]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("pas encore implémentée");
      expect(result.stderr).toContain(command);
      expect(result.stdout).toBe("");
    });
  }
});

describe("validate", () => {
  test("n'est plus annoncée comme non implémentée", () => {
    const result = run(["validate", "fichier-absent.yml"]);
    expect(result.stderr).not.toContain("pas encore implémentée");
  });

  test("sort en 2 quand le fichier est introuvable", () => {
    expect(run(["validate", "fichier-absent.yml"]).exitCode).toBe(2);
  });
});

describe("usage invalide", () => {
  test("sans argument, affiche l'aide sur stderr et sort en 2", () => {
    const result = run([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("start");
    expect(result.stdout).toBe("");
  });

  test("commande inconnue, sort en 2 en nommant la commande", () => {
    const result = run(["deploy"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("deploy");
  });
});
