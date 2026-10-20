import packageJson from "../package.json" with { type: "json" };

export const COMMANDS = ["start", "validate", "coverage", "export"] as const;

export type Command = (typeof COMMANDS)[number];

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const DESCRIPTIONS: Record<Command, string> = {
  start: "ouvre l'UI web locale sur le dépôt courant",
  validate: "valide le pipeline et la toolchain",
  coverage: "rapporte la couverture des couches OWASP DevSecOps",
  export: "exporte le modèle vers un format tiers",
};

function helpText(): string {
  const lines = [
    `keelson ${packageJson.version}`,
    "",
    "Usage : keelson <commande> [options]",
    "",
    "Commandes :",
    ...COMMANDS.map((command) => `  ${command.padEnd(10)}${DESCRIPTIONS[command]}`),
    "",
    "Options :",
    "  -h, --help       affiche cette aide",
    "  -v, --version    affiche la version",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

export function run(argv: readonly string[]): CliResult {
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

  if (isCommand(first)) {
    // DETTE(2026-10-20): commande `start` non implémentée — livrée au lot L2 avec l'UI.
    // DETTE(2026-10-20): commande `validate` non implémentée — livrée au lot L1 avec core.
    // DETTE(2026-10-20): commande `coverage` non implémentée — livrée au lot L3 avec taxonomy.
    // DETTE(2026-10-20): commande `export` non implémentée — livrée au lot L5.
    return {
      stdout: "",
      stderr: `keelson ${first} : commande pas encore implémentée.\n`,
      exitCode: 2,
    };
  }

  return {
    stdout: "",
    stderr: `keelson : commande inconnue « ${first} ».\n${helpText()}`,
    exitCode: 2,
  };
}
