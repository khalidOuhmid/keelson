/** The matrix of `.github/workflows/catalog-snippets.yml`: the catalogue's GitHub snippets that a
 *  hosted runner can start on its own, on the sample below. Run with `bun` to print it as JSON. */
import { parse as parseYaml } from "yaml";
import { loadCatalog, type Tool } from "../src/index.ts";

export const SAMPLE = "packages/catalog/test/snippet-sample";

export type SnippetRun = { tool: string; setup: string; run: string };

/** The snippets made of actions, which a matrix cannot inject: the workflow that runs those
 *  actions stands for them. */
export const ACTION_WORKFLOWS: Readonly<Record<string, string>> = {
  codeql: ".github/workflows/codeql.yml",
};

/** What a snippet needs that its text does not name. */
const UNNAMED_NEEDS: Readonly<Record<string, string>> = {
  "dependency-check": "an NVD API key, to download its database in time",
  ggshield: "a GitGuardian API key",
  "kube-bench": "a Kubernetes node to audit",
  promptfoo: "a model provider's API key",
  prowler: "AWS credentials",
  renovate: "a token for the platform it opens merge requests on",
  witness: "a signing key",
};

/** How to install the tools a snippet expects on the runner, from their official documentation. */
const SETUP: Readonly<Record<string, string>> = {
  "detect-secrets": "pipx install detect-secrets",
  kubescape:
    'curl -s https://raw.githubusercontent.com/kubescape/kubescape/master/install.sh | /bin/bash && echo "$HOME/.kubescape/bin" >> "$GITHUB_PATH"',
  lynis: "sudo apt-get update && sudo apt-get install -y lynis",
  modelscan: "pipx install modelscan",
  openscap: "sudo apt-get update && sudo apt-get install -y openscap-scanner",
};

/** The files of the sample each snippet reads. */
export const SAMPLE_INPUTS: Readonly<Record<string, readonly string[]>> = {
  bandit: ["app.py"],
  conftest: ["deployment.yaml", "policy/deployment.rego"],
  "cyclonedx-cli": ["sbom.cdx.json"],
  "detect-secrets": [".secrets.baseline"],
  gosec: ["go.mod", "main.go"],
  inspec: ["test.rb"],
  modelscan: ["model.pkl"],
  opa: ["policy/example.rego", "policy/example_test.rego"],
  openscap: ["scap-oval.xml"],
  spectral: ["openapi.yaml", ".spectral.yaml"],
  tflint: ["main.tf"],
};

const EXPRESSION = /\$\{\{.*?\}\}/g;
const VARIABLE = /\$\{?([A-Za-z_]\w*)\}?/g;
const PASSED = /(?:^|\s)(?:-e|--env)\s+([A-Za-z_]\w*)(?=\s|$)/g;

const isRunnerOwn = (name: string): boolean => name === "PWD" || name.startsWith("GITHUB_");

/** The workflow expressions, shell variables and passed-through variables of a snippet, in the
 *  order they appear: each has to come from somewhere the sample does not. */
export function externalInputs(text: string): string[] {
  const expressions = text.match(EXPRESSION) ?? [];
  const shell = text.replace(EXPRESSION, " ");
  const variables = [...shell.matchAll(VARIABLE)]
    .map((match) => match[1] ?? "")
    .filter((name) => !isRunnerOwn(name))
    .map((name) => `$${name}`);
  const passed = [...shell.matchAll(PASSED)]
    .map((match) => match[1] ?? "")
    .filter((name) => !isRunnerOwn(name));
  return [...new Set([...expressions, ...variables, ...passed])];
}

type Step = { run?: string; uses?: string; env?: Record<string, string> };

const stepsOf = (tool: Tool): Step[] =>
  tool.snippets.github === null ? [] : (parseYaml(tool.snippets.github) as Step[]);

function needsOf(tool: Tool): string | null {
  const unnamed = UNNAMED_NEEDS[tool.id];
  if (unnamed !== undefined) {
    return unnamed;
  }
  const text = stepsOf(tool)
    .flatMap((step) => [step.run ?? "", ...Object.values(step.env ?? {})])
    .join("\n");
  const inputs = externalInputs(text);
  return inputs.length === 0 ? null : inputs.join(", ");
}

const candidates = (tools: readonly Tool[]): Tool[] =>
  tools.filter(
    (tool) => tool.snippets.github !== null && !Object.hasOwn(ACTION_WORKFLOWS, tool.id),
  );

export function keptOpen(tools: readonly Tool[]): { tool: string; needs: string }[] {
  return candidates(tools).flatMap((tool) => {
    const needs = needsOf(tool);
    return needs === null ? [] : [{ tool: tool.id, needs }];
  });
}

export function snippetMatrix(tools: readonly Tool[]): { include: SnippetRun[] } {
  const include = candidates(tools)
    .filter((tool) => needsOf(tool) === null)
    .map((tool): SnippetRun => {
      const steps = stepsOf(tool);
      if (steps.some((step) => step.run === undefined)) {
        throw new Error(`${tool.id}: a snippet step without run needs a workflow of its own`);
      }
      return {
        tool: tool.id,
        setup: SETUP[tool.id] ?? "",
        run: steps.map((step) => (step.run ?? "").trim()).join("\n"),
      };
    });
  return { include };
}

if (import.meta.main) {
  process.stdout.write(JSON.stringify(snippetMatrix(loadCatalog().tools)));
}
