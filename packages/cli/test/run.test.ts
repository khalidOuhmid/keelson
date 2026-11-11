import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { COMMANDS, run } from "../src/run.ts";

describe("--version", () => {
  test("affiche la version du package.json et sort en 0", async () => {
    const result = await run(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("accepte -v", async () => {
    expect((await run(["-v"])).stdout.trim()).toBe(packageJson.version);
  });
});

describe("--help", () => {
  test("liste les commandes prévues et sort en 0", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    for (const command of ["start", "validate", "coverage", "catalog", "export", "apply"]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("accepte -h", async () => {
    expect((await run(["-h"])).exitCode).toBe(0);
  });
});

describe("<commande> --help", () => {
  const FLAGS: Record<string, string[]> = {
    start: ["--port", "--no-open"],
    validate: ["--format"],
    coverage: ["--require", "--format"],
    catalog: ["lint"],
    export: ["--format"],
    apply: ["--file", "--rebase", "--dry-run", "--json"],
  };

  for (const command of COMMANDS) {
    test(`${command} --help rend l'usage de la commande et sort en 0, sans l'exécuter`, async () => {
      const result = await run([command, "--help"], { cwd: "/nonexistent-keelson-dir" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`Usage: keelson ${command}`);
      for (const flag of FLAGS[command] ?? []) {
        expect(result.stdout).toContain(flag);
      }
    });
  }

  test("-h vaut --help, où qu'il soit parmi les options", async () => {
    const result = await run(["coverage", "x.yml", "-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: keelson coverage");
  });

  test("après --, --help est un argument et non une demande d'aide", async () => {
    const result = await run(["validate", "--", "--help"], { cwd: "/nonexistent-keelson-dir" });
    expect(result.stdout).not.toContain("Usage: keelson validate");
  });
});

describe("commandes", () => {
  test("COMMANDS déclare les commandes prévues", () => {
    expect(COMMANDS).toEqual(["start", "validate", "coverage", "catalog", "export", "apply"]);
  });
});

describe("start", () => {
  test("n'est plus annoncée comme non implémentée", async () => {
    const result = await run(["start", "--turbo"]);
    expect(result.stderr).not.toContain("not implemented yet");
  });

  test("une option inconnue sort en 2 sans démarrer de serveur", async () => {
    expect((await run(["start", "--turbo"])).exitCode).toBe(2);
  });
});

describe("validate", () => {
  test("n'est plus annoncée comme non implémentée", async () => {
    const result = await run(["validate", "fichier-absent.yml"]);
    expect(result.stderr).not.toContain("not implemented yet");
  });

  test("sort en 2 quand le fichier est introuvable", async () => {
    expect((await run(["validate", "fichier-absent.yml"])).exitCode).toBe(2);
  });
});

describe("usage invalide", () => {
  test("sans argument, affiche l'aide sur stderr et sort en 2", async () => {
    const result = await run([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("start");
    expect(result.stdout).toBe("");
  });

  test("commande inconnue, sort en 2 en nommant la commande", async () => {
    const result = await run(["deploy"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("deploy");
  });
});
