// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell variables and workflow expressions, written as in the snippets
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadCatalog } from "../src/index.ts";
import {
  ACTION_WORKFLOWS,
  externalInputs,
  keptOpen,
  SAMPLE,
  SAMPLE_INPUTS,
  snippetMatrix,
} from "./snippet-matrix.ts";

const { tools } = loadCatalog();
const repoRoot = join(import.meta.dir, "..", "..", "..");
const matrix = snippetMatrix(tools);
const inMatrix = matrix.include.map((entry) => entry.tool);
const open = keptOpen(tools).map((entry) => entry.tool);

describe("the inputs a GitHub snippet takes from outside", () => {
  test("are its shell variables, the working directory and GitHub's own excepted", () => {
    expect(externalInputs('docker run -v "$PWD:/src" x nikto.pl -h $TARGET_URL')).toEqual([
      "$TARGET_URL",
    ]);
    expect(externalInputs('sentry-cli releases new "$GITHUB_SHA"')).toEqual([]);
    expect(externalInputs('curl "${DOJO_URL}/api"')).toEqual(["$DOJO_URL"]);
  });

  test("include the variables docker run passes through and the workflow expressions", () => {
    expect(externalInputs("docker run --rm -e SONAR_TOKEN -v x img")).toEqual(["SONAR_TOKEN"]);
    expect(externalInputs("zap-baseline.py -t ${{ vars.TARGET_URL }}")).toEqual([
      "${{ vars.TARGET_URL }}",
    ]);
  });
});

describe("the snippet matrix", () => {
  test("runs every snippet that needs neither a credential nor a live target", () => {
    expect(inMatrix).toEqual([
      "bandit",
      "checkov",
      "conftest",
      "cyclonedx-cli",
      "detect-secrets",
      "gitleaks",
      "gosec",
      "grype",
      "inspec",
      "kics",
      "kubescape",
      "lynis",
      "modelscan",
      "opa",
      "openscap",
      "osv-scanner",
      "semgrep",
      "spectral",
      "syft",
      "tflint",
      "trivy",
      "trufflehog",
    ]);
  });

  test("runs the snippet's own command, unchanged", () => {
    const trivy = matrix.include.find((entry) => entry.tool === "trivy");
    expect(trivy).toEqual({
      tool: "trivy",
      setup: "",
      run: 'docker run --rm -v "$PWD:/src" -w /src --entrypoint "" aquasec/trivy:latest trivy fs --scanners vuln,secret,misconfig .',
    });
  });

  test("installs the tool first when the snippet expects it on the runner", () => {
    const bare = matrix.include.filter(
      (entry) => !entry.run.startsWith("docker run") && entry.setup === "",
    );
    expect(bare.map((entry) => entry.tool)).toEqual([]);
  });

  test("keeps open, by name, the tools that need a credential or a live target", () => {
    expect(keptOpen(tools)).toEqual([
      { tool: "cosign", needs: "$IMAGE" },
      { tool: "defectdojo", needs: "$DOJO_URL, $DOJO_TOKEN, $DOJO_ENGAGEMENT" },
      { tool: "dependency-check", needs: "an NVD API key, to download its database in time" },
      { tool: "dependency-track", needs: "$DTRACK_URL, $DTRACK_KEY, $DTRACK_PROJECT" },
      { tool: "garak", needs: "$MODEL" },
      { tool: "ggshield", needs: "a GitGuardian API key" },
      { tool: "kube-bench", needs: "a Kubernetes node to audit" },
      { tool: "nikto", needs: "$TARGET_URL" },
      { tool: "nuclei", needs: "$TARGET_URL" },
      { tool: "promptfoo", needs: "a model provider's API key" },
      { tool: "prowler", needs: "AWS credentials" },
      { tool: "renovate", needs: "a token for the platform it opens merge requests on" },
      { tool: "schemathesis", needs: "$API_URL" },
      { tool: "scorecard", needs: "${{ github.token }}" },
      { tool: "sentry", needs: "SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT" },
      { tool: "snyk", needs: "${{ secrets.SNYK_TOKEN }}" },
      { tool: "sonarqube", needs: "SONAR_HOST_URL, SONAR_TOKEN" },
      { tool: "vault", needs: "VAULT_ADDR, VAULT_TOKEN" },
      { tool: "witness", needs: "a signing key" },
      { tool: "zap", needs: "${{ vars.TARGET_URL }}" },
    ]);
  });

  test("leaves no GitHub snippet unaccounted for, and none counted twice", () => {
    const accounted = [...inMatrix, ...open, ...Object.keys(ACTION_WORKFLOWS)].sort();
    const withSnippet = tools
      .filter((tool) => tool.snippets.github !== null)
      .map((tool) => tool.id)
      .sort();
    expect(accounted).toEqual(withSnippet);
  });

  test("refuses a snippet that uses an action no workflow runs", () => {
    const action = {
      ...tools[0],
      id: "acme",
      snippets: { gitlab: null, github: "- uses: a/b@v1\n" },
    };
    expect(() => snippetMatrix([action as (typeof tools)[number]])).toThrow("acme");
  });
});

describe("the snippets made of actions", () => {
  test("run, step for step, in the workflow that stands for them", () => {
    const missing = Object.entries(ACTION_WORKFLOWS).flatMap(([id, file]) => {
      const tool = tools.find((entry) => entry.id === id);
      const steps = parseYaml(tool?.snippets.github ?? "[]") as { uses?: string }[];
      const workflow = readFileSync(join(repoRoot, file), "utf8");
      return steps.flatMap((step) =>
        step.uses === undefined || workflow.includes(`uses: ${step.uses}`)
          ? []
          : [`${id}: ${step.uses}`],
      );
    });
    expect(missing).toEqual([]);
  });
});

describe("the sample the snippets run on", () => {
  test("holds the files the snippets read", () => {
    const absent = Object.entries(SAMPLE_INPUTS).flatMap(([id, files]) =>
      files.filter((file) => !existsSync(join(repoRoot, SAMPLE, file))).map((f) => `${id}: ${f}`),
    );
    expect(absent).toEqual([]);
  });

  test("names only tools of the matrix", () => {
    expect(Object.keys(SAMPLE_INPUTS).filter((id) => !inMatrix.includes(id))).toEqual([]);
  });

  test("every file a matrix snippet names in its arguments is in the sample", () => {
    const named = matrix.include.flatMap((entry) =>
      (entry.run.match(/(?<=\s)[\w.-]+\.(?:ya?ml|json|rb|pkl|xml|baseline)(?=\s|$)/g) ?? [])
        .filter((file) => !(SAMPLE_INPUTS[entry.tool] ?? []).includes(file))
        .filter((file) => !OUTPUTS.includes(file))
        .map((file) => `${entry.tool}: ${file}`),
    );
    expect(named).toEqual([]);
  });
});

const OUTPUTS = ["gitleaks-report.json", "oval-results.xml"];

describe("the catalog-snippets workflow", () => {
  const text = readFileSync(join(repoRoot, ".github/workflows/catalog-snippets.yml"), "utf8");
  const workflow = parseYaml(text) as {
    on: Record<string, unknown>;
    jobs: Record<string, { steps: { run?: string; env?: Record<string, string> }[] }>;
  };
  const runs = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run])),
  );

  test("runs by hand and every week, never on a push or a pull request", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });

  test("builds its matrix with this module", () => {
    expect(runs.some((run) => run.includes("bun packages/catalog/test/snippet-matrix.ts"))).toBe(
      true,
    );
  });

  test("prepares the sample as a git repository, which the secret scanners read", () => {
    expect(runs.some((run) => run.includes(SAMPLE) && run.includes("git init"))).toBe(true);
  });

  test("fails on the exit codes of a command that could not start", () => {
    expect(runs.some((run) => /125\|126\|127\)/.test(run))).toBe(true);
  });

  test("hands the snippet to the shell through the environment, not the script text", () => {
    expect(
      runs.filter((run) => run.includes("matrix.run") || run.includes("matrix.setup")),
    ).toEqual([]);
  });
});
