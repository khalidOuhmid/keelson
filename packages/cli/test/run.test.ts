import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { COMMANDS, run } from "../src/run.ts";

describe("--version", () => {
  test("prints the package.json version and exits 0", async () => {
    const result = await run(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("accepts -v", async () => {
    expect((await run(["-v"])).stdout.trim()).toBe(packageJson.version);
  });
});

describe("--help", () => {
  test("lists the planned commands and exits 0", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    for (const command of ["start", "validate", "coverage", "catalog", "export", "apply"]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("accepts -h", async () => {
    expect((await run(["-h"])).exitCode).toBe(0);
  });
});

describe("<command> --help", () => {
  const FLAGS: Record<string, string[]> = {
    start: ["--port", "--no-open"],
    validate: ["--format"],
    coverage: ["--require", "--format"],
    catalog: ["lint"],
    export: ["--format"],
    apply: ["--file", "--rebase", "--dry-run", "--json"],
  };

  for (const command of COMMANDS) {
    test(`${command} --help prints the command's usage and exits 0, without running it`, async () => {
      const result = await run([command, "--help"], { cwd: "/nonexistent-keelson-dir" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`Usage: keelson ${command}`);
      for (const flag of FLAGS[command] ?? []) {
        expect(result.stdout).toContain(flag);
      }
    });
  }

  test("-h means --help, wherever it sits among the options", async () => {
    const result = await run(["coverage", "x.yml", "-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: keelson coverage");
  });

  test("after --, --help is an argument, not a help request", async () => {
    const result = await run(["validate", "--", "--help"], { cwd: "/nonexistent-keelson-dir" });
    expect(result.stdout).not.toContain("Usage: keelson validate");
  });
});

describe("commands", () => {
  test("COMMANDS declares the planned commands", () => {
    expect(COMMANDS).toEqual(["start", "validate", "coverage", "catalog", "export", "apply"]);
  });
});

describe("start", () => {
  test("is no longer announced as not implemented", async () => {
    const result = await run(["start", "--turbo"]);
    expect(result.stderr).not.toContain("not implemented yet");
  });

  test("an unknown option exits 2 without starting a server", async () => {
    expect((await run(["start", "--turbo"])).exitCode).toBe(2);
  });
});

describe("validate", () => {
  test("is no longer announced as not implemented", async () => {
    const result = await run(["validate", "fichier-absent.yml"]);
    expect(result.stderr).not.toContain("not implemented yet");
  });

  test("exits 2 when the file is not found", async () => {
    expect((await run(["validate", "fichier-absent.yml"])).exitCode).toBe(2);
  });
});

describe("invalid usage", () => {
  test("without arguments, prints help on stderr and exits 2", async () => {
    const result = await run([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("start");
    expect(result.stdout).toBe("");
  });

  test("unknown command, exits 2 naming the command", async () => {
    const result = await run(["deploy"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("deploy");
  });
});
