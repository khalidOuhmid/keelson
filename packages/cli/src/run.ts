import packageJson from "../package.json" with { type: "json" };
import type { CliResult } from "./result.ts";
import type { StartDeps } from "./start.ts";
import { startCommand } from "./start.ts";
import { validateCommand } from "./validate.ts";

export const COMMANDS = ["start", "validate", "coverage", "export"] as const;

export type Command = (typeof COMMANDS)[number];

export type { CliResult } from "./result.ts";

export type RunOptions = {
  cwd?: string;
  startDeps?: StartDeps;
};

const DESCRIPTIONS: Record<Command, string> = {
  start: "open the local web UI on the current repository",
  validate: "validate the pipeline and the toolchain",
  coverage: "report coverage of the OWASP DevSecOps layers",
  export: "export the model to a third-party format",
};

function helpText(): string {
  const lines = [
    `keelson ${packageJson.version}`,
    "",
    "Usage: keelson <command> [options]",
    "",
    "Commands:",
    ...COMMANDS.map((command) => `  ${command.padEnd(10)}${DESCRIPTIONS[command]}`),
    "",
    "Options:",
    "  -h, --help       show this help",
    "  -v, --version    show the version",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

export async function run(argv: readonly string[], options: RunOptions = {}): Promise<CliResult> {
  const [first] = argv;

  if (first === undefined) {
    return { stdout: "", stderr: helpText(), exitCode: 2 };
  }

  if (first === "--version" || first === "-v") {
    return { stdout: `${packageJson.version}\n`, stderr: "", exitCode: 0 };
  }

  if (first === "--help" || first === "-h") {
    return { stdout: helpText(), stderr: "", exitCode: 0 };
  }

  if (first === "validate") {
    return validateCommand(argv.slice(1), options.cwd ?? process.cwd());
  }

  if (first === "start") {
    return startCommand(argv.slice(1), options.cwd ?? process.cwd(), options.startDeps ?? {});
  }

  if (isCommand(first)) {
    // DETTE(2026-10-20): commande `coverage` non implémentée — livrée au lot L3 avec taxonomy.
    // DETTE(2026-10-20): commande `export` non implémentée — livrée au lot L5.
    return {
      stdout: "",
      stderr: `keelson ${first}: command not implemented yet.\n`,
      exitCode: 2,
    };
  }

  return {
    stdout: "",
    stderr: `keelson: unknown command "${first}".\n${helpText()}`,
    exitCode: 2,
  };
}
