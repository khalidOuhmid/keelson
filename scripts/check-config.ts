function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function biomeLintProblems(config: unknown): string[] {
  const linter = record(record(config).linter);
  if (linter.enabled === false) {
    return ["linter.enabled is false"];
  }
  const rules = record(linter.rules);
  if (!("preset" in rules)) {
    return ["linter.rules.preset is missing"];
  }
  if (rules.preset === "none") {
    return ['linter.rules.preset is "none": every lint rule is disabled'];
  }
  if (typeof rules.preset !== "string" || rules.preset === "") {
    return ["linter.rules.preset is empty"];
  }
  return [];
}

export function tsconfigProblems(config: unknown): string[] {
  const options = record(record(config).compilerOptions);
  const problems: string[] = [];
  if ("baseUrl" in options) {
    problems.push("compilerOptions.baseUrl no longer exists in TypeScript 7");
  }
  for (const [alias, targets] of Object.entries(record(options.paths))) {
    for (const target of Array.isArray(targets) ? targets : [targets]) {
      if (typeof target !== "string" || !/^\.\.?\//.test(target)) {
        problems.push(`compilerOptions.paths["${alias}"] is not relative: ${String(target)}`);
      }
    }
  }
  return problems;
}
