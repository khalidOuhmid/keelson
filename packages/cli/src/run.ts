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

const USAGES: Record<Command, readonly string[]> = {
  start: [
    "keelson start [dir] [--port <n>] [--no-open]",
    "",
    "  dir            repository to open (default: current directory)",
    "  --port <n>     port to listen on, 127.0.0.1 only (default: a free port)",
    "  --no-open      print the URL without opening a browser",
  ],
  validate: [
    "keelson validate [file] [--format text|json]",
    "",
    "  file           one CI file (default: every CI file of the repository)",
    "  --format       text (default) or json; exit 1 on any error",
  ],
  coverage: [
    "keelson coverage [file] [--require <layers>] [--format text|json]",
    "",
    "  file           one CI file (default: every CI file of the repository)",
    "  --require      comma-separated layer ids; exit 1 if one is not covered, 2 if unknown",
    "  --format       text (default) or json",
  ],
  catalog: [
    "keelson catalog lint [dir]",
    "",
    "  lint [dir]     lint tools/*.yaml in dir (default: the embedded catalogue)",
  ],
  export: [
    "keelson export [file] [--format markdown|mermaid|json]",
    "",
    "  file           one CI file (default: every CI file of the repository)",
    "  --format       markdown (default), mermaid or json",
  ],
  apply: [
    "keelson apply <ops.json> [repo...] [--file <path>] [--rebase] [--dry-run] [--json]",
    "",
    "  ops.json       one operation or an array, applied in order, all or nothing per repo",
    "  repo...        repositories to edit (default: current directory)",
    "  --file <path>  file to edit in each repository (default: .gitlab-ci.yml); a",
    "                 .github/workflows/*.yml takes GitHub operations, and",
    "                 .devsecops/toolchain.yaml takes toolchain operations",
    "  --rebase       anchor each operation on the current text of each repository;",
    "                 baseHash may then be left out",
    "  --dry-run      print the diffs, write nothing",
    "  --json         machine-readable report",
  ],
};

function commandHelp(command: Command): string {
  const [synopsis, ...rest] = USAGES[command];
  return `${[`Usage: ${synopsis}`, ...rest, ""].join("\n")}\n`;
}

function asksForHelp(argv: readonly string[]): boolean {
  const end = argv.indexOf("--");
  const options = end === -1 ? argv : argv.slice(0, end);
  return options.some((arg) => arg === "--help" || arg === "-h");
}

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
    "  -h, --help       show this help, or a command's usage after its name",
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

  if (COMMANDS.includes(first as Command) && asksForHelp(argv.slice(1))) {
    return { stdout: commandHelp(first as Command), stderr: "", exitCode: 0 };
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
