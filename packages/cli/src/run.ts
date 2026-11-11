import packageJson from "../package.json" with { type: "json" };
import { applyCommand } from "./apply.ts";
import { catalogCommand } from "./catalog.ts";
import { coverageCommand } from "./coverage.ts";
import { exportCommand } from "./export.ts";
import type { CliResult } from "./result.ts";
import type { StartDeps } from "./start.ts";
import { startCommand } from "./start.ts";
import { validateCommand } from "./validate.ts";

export const COMMANDS = ["start", "validate", "coverage", "catalog", "export", "apply"] as const;

export type Command = (typeof COMMANDS)[number];

export type { CliResult } from "./result.ts";

export type RunOptions = {
  cwd?: string;
  startDeps?: StartDeps;
  now?: Date;
};

const DESCRIPTIONS: Record<Command, string> = {
  start: "open the local web UI on the current repository",
  validate: "validate the pipeline and the toolchain",
  coverage: "report coverage of the OWASP DevSecOps layers",
  catalog: "lint the tool catalogue",
  export: "export the model to a third-party format",
  apply: "apply a sequence of operations to one or more repositories",
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

  if (first === "coverage") {
    return coverageCommand(argv.slice(1), options.cwd ?? process.cwd());
  }

  if (first === "catalog") {
    return catalogCommand(argv.slice(1), options.cwd ?? process.cwd(), options.now ?? new Date());
  }

  if (first === "export") {
    return exportCommand(argv.slice(1), options.cwd ?? process.cwd());
  }

  if (first === "apply") {
    return applyCommand(argv.slice(1), options.cwd ?? process.cwd());
  }

  return {
    stdout: "",
    stderr: `keelson: unknown command "${first}".\n${helpText()}`,
    exitCode: 2,
  };
}
