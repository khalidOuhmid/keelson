import { describe, expect, test } from "bun:test";
import type { Job, Pipeline } from "@keelson/core";
import { parse as parseYaml } from "yaml";
import { coverage, detectIntegrations, detectTools, loadCatalog, type Tool } from "../src/index.ts";

const { tools } = loadCatalog();

function catalogTool(id: string): Tool {
  const found = tools.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(id);
  }
  return found;
}

function tool(id: string, overrides: Partial<Tool> = {}): Tool {
  return {
    id,
    name: id,
    kind: "job",
    layers: ["sast"],
    license: "MIT",
    homepage: "https://exemple.org",
    verifiedAt: "https://exemple.org",
    logo: null,
    integration: null,
    detect: { images: [`exemple/${id}`], scripts: [`\\b${id}\\b`], actions: [] },
    snippets: { gitlab: null, github: null },
    lastVerified: "2026-11-04",
    ...overrides,
  };
}

function job(id: string, image: string | null, script: string[] = []): Job {
  return {
    id,
    stage: { value: "test", origin: { kind: "local" } },
    needs: null,
    environment: null,
    extends: [],
    opaque: [],
    signals: { image, script },
    range: { start: 0, end: 1 },
    file: ".gitlab-ci.yml",
  };
}

function pipeline(jobs: Job[], unresolved: Pipeline["unresolved"] = []): Pipeline {
  return {
    stages: [],
    jobs,
    templates: [],
    opaque: [],
    main: ".gitlab-ci.yml",
    files: [".gitlab-ci.yml"],
    unresolved,
  };
}

describe("detected integrations", () => {
  const service = tool("nexus", { kind: "service", integration: "push" });

  test("a job script naming a service that carries an integration", () => {
    expect(detectIntegrations({ image: null, script: ["nexus upload"] }, [service])).toEqual([
      { tool: "nexus", kind: "push" },
    ]);
  });

  test("the image alone does not prove the integration", () => {
    expect(detectIntegrations({ image: "exemple/nexus", script: [] }, [service])).toEqual([]);
  });

  test("a service action declared by the entry proves the integration", () => {
    const vault = tool("vault", {
      kind: "service",
      integration: "fetch-secret",
      detect: { images: [], scripts: [], actions: ["hashicorp/vault-action"] },
    });
    expect(
      detectIntegrations({ image: null, script: [], actions: ["hashicorp/vault-action@v3"] }, [
        vault,
      ]),
    ).toEqual([{ tool: "vault", kind: "fetch-secret" }]);
  });

  test("a docker:// action is an image, and does not prove the integration either", () => {
    expect(
      detectIntegrations({ image: null, script: [], actions: ["docker://exemple/nexus"] }, [
        service,
      ]),
    ).toEqual([]);
  });

  test("the real Vault action proposes a fetch-secret", () => {
    expect(
      detectIntegrations(
        { image: null, script: [], actions: ["hashicorp/vault-action@v3"] },
        tools,
      ),
    ).toEqual([{ tool: "vault", kind: "fetch-secret" }]);
  });

  test("a tool without integration proposes nothing", () => {
    expect(detectIntegrations({ image: null, script: ["trivy"] }, [tool("trivy")])).toEqual([]);
  });

  test("a service covers a layer, and the result names it", () => {
    const result = coverage(
      pipeline([]),
      [tool("gitea", { kind: "service", layers: ["scm"] })],
      {},
      [],
      [{ id: "git", tool: "gitea", url: null, environment: null }],
    );
    const entry = result.layers.find((layer) => layer.layer === "scm");
    expect(entry).toEqual({ layer: "scm", covered: true, jobs: [], services: ["git"], ci: [] });
  });

  test("a service whose tool is unknown covers nothing", () => {
    const result = coverage(
      pipeline([]),
      [],
      {},
      [],
      [{ id: "git", tool: "gitea", url: null, environment: null }],
    );
    expect(result.layers.every((layer) => !layer.covered)).toBe(true);
  });
});

describe("the real catalogue entries", () => {
  test("mandatory platform tools declare their integration", () => {
    const of = (id: string) => catalogTool(id).integration;
    expect(of("nexus")).toBe("push");
    expect(of("harbor")).toBe("push");
    expect(of("artifactory")).toBe("push");
    expect(of("defectdojo")).toBe("upload-report");
    expect(of("dependency-track")).toBe("upload-report");
    expect(of("sonarqube")).toBe("upload-report");
    expect(of("vault")).toBe("fetch-secret");
    expect(of("openbao")).toBe("fetch-secret");
    expect(of("sentry")).toBe("notify");
  });

  const catalog = loadCatalog();
  const found = (signals: { image: string | null; script: string[] }) =>
    detectTools(signals, catalog.tools).map((entry) => entry.tool);

  test.each([
    ['bash -c "trivy fs ."', "trivy"],
    ["sh -c 'trivy image x'", "trivy"],
    ["(trivy fs .)", "trivy"],
    ["time(trivy fs .)", "trivy"],
    ['bash -c "semgrep scan"', "semgrep"],
  ])("script %s names %s", (line, tool) => {
    expect(found({ image: null, script: [line] })).toContain(tool);
  });

  test.each([
    "zaproxy/zap-stable:2.15",
    "zaproxy/zap-weekly",
    "ghcr.io/zaproxy/zaproxy:stable",
    "owasp/zap2docker-stable",
    "owasp/zap2docker-live",
    "owasp/zap2docker-bare:latest",
  ])("official image %s is ZAP", (image) => {
    expect(found({ image, script: [] })).toContain("zap");
  });

  test("a snippet script claims only the layers of its own entry", () => {
    const foreign = catalog.tools.flatMap((tool) => {
      const snippet = tool.snippets.gitlab;
      if (snippet === null) {
        return [];
      }
      const jobs = parseYaml(snippet) as Record<string, { script?: string[] }>;
      const script = Object.values(jobs).flatMap((job) => job.script ?? []);
      return detectTools({ image: null, script }, catalog.tools)
        .filter((entry) => entry.layers.some((layer) => !tool.layers.includes(layer)))
        .map((entry) => `${tool.id} detects ${entry.tool}`);
    });
    expect(foreign).toEqual([]);
  });

  test("a word inside a string is not a command", () => {
    expect(
      found({ image: null, script: ['curl -F scan_type="Trivy Scan" https://x'] }),
    ).not.toContain("trivy");
  });

  test("an empty string before a quoted argument does not swallow the words between them", () => {
    expect(
      found({
        image: null,
        script: ['docker run --entrypoint "" getsentry/sentry-cli:latest sentry-cli x "$SHA"'],
      }),
    ).toContain("sentry");
  });

  test("every GitLab snippet image is recognised by its own entry", () => {
    const missed = catalog.tools.flatMap((tool) => {
      const snippet = tool.snippets.gitlab;
      if (snippet === null) {
        return [];
      }
      const jobs = parseYaml(snippet) as Record<string, { image?: string | { name: string } }>;
      return Object.values(jobs).flatMap((job) => {
        const image = typeof job.image === "object" ? job.image.name : (job.image ?? null);
        return image === null || found({ image, script: [] }).includes(tool.id)
          ? []
          : [`${tool.id}: ${image}`];
      });
    });
    expect(missed).toEqual([]);
  });
});

describe("detection", () => {
  test("on the image, ignoring case and tag", () => {
    expect(detectTools({ image: "Exemple/Outil:1.2", script: [] }, [tool("outil")])).toEqual([
      { tool: "outil", layers: ["sast"] },
    ]);
  });

  test("on the script", () => {
    expect(detectTools({ image: null, script: ["./run", "outil --x"] }, [tool("outil")])).toEqual([
      { tool: "outil", layers: ["sast"] },
    ]);
  });

  test("a word containing the name does not match", () => {
    expect(detectTools({ image: null, script: ["outillage"] }, [tool("outil")])).toEqual([]);
  });

  test("a job can match several tools", () => {
    const found = detectTools({ image: null, script: ["a && b"] }, [tool("a"), tool("b")]);
    expect(found.map((entry) => entry.tool)).toEqual(["a", "b"]);
  });

  test("the script ignores case", () => {
    expect(detectTools({ image: null, script: ["OUTIL --x"] }, [tool("outil")])).toHaveLength(1);
  });

  test("a mirror or a private registry is still the same image", () => {
    const found = (image: string) =>
      detectTools({ image, script: [] }, [
        tool("trivy", { detect: { images: ["aquasec/trivy"], scripts: [], actions: [] } }),
      ]);
    expect(found("ghcr.io/aquasecurity/trivy:0.5")).toHaveLength(1);
    expect(found("registry.example.org:5000/mirror/trivy@sha256:abc")).toHaveLength(1);
    expect(found("mycorp/trivy-report-uploader")).toEqual([]);
  });

  /** On the real catalogue, because false positives come from its regexes, not from the engine. */
  test.each([
    ["make test", []],
    ["npm run build", []],
    ["echo vault is closed", []],
    ["docker push registry.example.org/app", []],
    ["trivy image app:1", ["trivy"]],
    ["semgrep ci", ["semgrep"]],
    ["vault kv get secret/x", ["vault"]],
    ["sonar-scanner", ["sonarqube"]],
    ["mvn sonar:sonar", ["sonarqube"]],
    ["./gradlew sonar", ["sonarqube"]],
    ["dotnet sonarscanner begin /k:x", ["sonarqube"]],
    ["semgrep --config auto .", ["semgrep"]],
    ["trivy --cache-dir x image a", ["trivy"]],
    ["trivy -q fs .", ["trivy"]],
    ["make && trivy fs .", ["trivy"]],
    ["sudo /usr/local/bin/trivy fs .", ["trivy"]],
    ["cp renovate.json /tmp/", []],
    ["rm -rf nexus-data", []],
    ["kubectl get pods -n grafana", []],
    ["# semgrep ci disabled", []],
    ["echo 'skip trivy image scan'", []],
    ["cat dongtai.log", []],
    ["ls checkov-report.json", []],
  ])("%s", (line, expected) => {
    expect(detectTools({ image: null, script: [line] }, tools).map((d) => d.tool)).toEqual(
      expected,
    );
  });
});

describe("coverage", () => {
  const CATALOG = [tool("a", { layers: ["sast", "sca"] }), tool("b", { layers: ["dast"] })];

  test("a covered layer names its jobs, and the others are listed as uncovered", () => {
    const result = coverage(pipeline([job("x", null, ["a"]), job("y", null, ["a"])]), CATALOG);
    expect(result.layers.find((entry) => entry.layer === "sast")).toEqual({
      layer: "sast",
      covered: true,
      jobs: ["x", "y"],
      services: [],
      ci: [],
    });
    expect(result.layers.find((entry) => entry.layer === "dast")?.covered).toBe(false);
    expect(result.layers).toHaveLength(21);
  });

  test("each job carries its layers and its tools", () => {
    expect(coverage(pipeline([job("x", null, ["a"])]), CATALOG).jobs).toEqual([
      { job: "x", layers: ["sca", "sast"], tools: ["a"], overridden: false },
    ]);
  });

  test("an override replaces detection, the detected tool stays named", () => {
    const result = coverage(pipeline([job("x", null, ["a"])]), CATALOG, { x: ["dast"] });
    expect(result.jobs[0]).toEqual({
      job: "x",
      layers: ["dast"],
      tools: ["a"],
      overridden: true,
    });
    expect(result.layers.find((entry) => entry.layer === "sast")?.covered).toBe(false);
  });

  test("an empty override disables a false positive", () => {
    const result = coverage(pipeline([job("x", null, ["a"])]), CATALOG, { x: [] });
    expect(result.jobs[0]?.layers).toEqual([]);
  });

  test("an override applies to a job without detection", () => {
    const result = coverage(pipeline([job("x", null)]), CATALOG, { x: ["iast"] });
    expect(result.layers.find((entry) => entry.layer === "iast")?.jobs).toEqual(["x"]);
  });

  test("a key inherited from Object is not an override", () => {
    expect(coverage(pipeline([job("constructor", null)]), CATALOG).jobs[0]?.overridden).toBe(false);
  });

  test("an unreadable file also makes coverage partial", () => {
    const broken = [
      { code: "INVALID_YAML", severity: "error", params: { detail: "x" }, range: null, file: "a" },
    ] as const;
    expect(coverage(pipeline([]), CATALOG, {}, [...broken]).partial).toBe(true);
  });

  test("a partial pipeline yields partial coverage", () => {
    const unresolved = [{ form: "remote" as const, detail: "x", from: "a", range: null }];
    expect(coverage(pipeline([], unresolved), CATALOG).partial).toBe(true);
    expect(coverage(pipeline([]), CATALOG).partial).toBe(false);
  });
});

/** Only a forge runs its CI: a job read from a GitLab CI file or a GitHub workflow proves that the
 *  repository is hosted on one. */
describe("source control, proven by the CI that runs the jobs", () => {
  const scm = (jobs: Job[]) =>
    coverage(pipeline(jobs), []).layers.find((entry) => entry.layer === "scm");
  const inWorkflow = (id: string): Job => ({ ...job(id, null), file: ".github/workflows/ci.yml" });

  test("a job of a GitLab CI file covers it", () => {
    expect(scm([{ ...job("x", null), file: "ci/jobs.yml" }])).toEqual({
      layer: "scm",
      covered: true,
      jobs: [],
      services: [],
      ci: ["gitlab-ci"],
    });
  });

  test("a job of a GitHub workflow covers it", () => {
    expect(scm([inWorkflow("x")])?.ci).toEqual(["github-actions"]);
  });

  test("a repository with both names both, once each", () => {
    expect(scm([job("a", null), inWorkflow("b"), job("c", null)])?.ci).toEqual([
      "gitlab-ci",
      "github-actions",
    ]);
  });

  test("a pipeline without jobs proves nothing", () => {
    expect(scm([])).toMatchObject({ covered: false, ci: [] });
  });

  test("no other layer is proven by the CI", () => {
    const others = coverage(pipeline([job("x", null)]), []).layers.filter(
      (entry) => entry.layer !== "scm",
    );
    expect(others.filter((entry) => entry.covered || entry.ci.length > 0)).toEqual([]);
  });
});

describe("two workflows, one job name", () => {
  test("a layer names the job only once", () => {
    const twice = [job("x", null, ["a"]), job("x", null, ["a"])];
    const entry = coverage(pipeline(twice), [
      tool("a", { detect: { images: [], scripts: ["\\ba\\b"], actions: [] } }),
    ]).layers.find((layer) => layer.layer === "sast");
    expect(entry?.jobs).toEqual(["x"]);
  });
});

describe("GitHub actions", () => {
  const catalog = loadCatalog();
  const found = (signals: { image: string | null; actions: string[] }) =>
    detectTools({ ...signals, script: [] }, catalog.tools).map((entry) => entry.tool);

  test("uploading a SARIF is not analysing", () => {
    expect(found({ image: null, actions: ["github/codeql-action/upload-sarif@v3"] })).toEqual([]);
    expect(found({ image: null, actions: ["github/codeql-action/analyze@v3"] })).toContain(
      "codeql",
    );
  });

  test("a docker:// counts as an image, even behind a container", () => {
    expect(found({ image: "node:20", actions: ["docker://aquasec/trivy"] })).toContain("trivy");
  });
});

describe("shell splitting on hostile input", () => {
  const catalog = loadCatalog();
  test.each([
    ["nested $(", "$(".repeat(5000)],
    ["nested sh -c", "bash -c ".repeat(5000)],
    ["nested kubectl exec", "kubectl exec a -- ".repeat(5000)],
    ["a huge line", "a ".repeat(500000)],
    ["many heredocs", "cat <<a ".repeat(5000) + "\nx\n".repeat(5000)],
    ["quoted parentheses", `$(${'")" '.repeat(20000)}`],
  ])("%s does not crash and stays fast", (_label, line) => {
    const started = performance.now();
    expect(() => detectTools({ image: null, script: [line] }, catalog.tools)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test.each([
    ['bash -o pipefail -c "trivy fs ."'],
    ['timeout 60 bash -c "trivy fs ."'],
    ['nice -n 10 sh -c "trivy fs ."'],
    ['docker exec c bash -c "trivy fs ."'],
    ['xargs sh -c "trivy fs ."'],
    ['eval "trivy fs ."'],
    ['ssh host "trivy fs ."'],
    ['su -c "trivy fs ."'],
    ["timeout 60 trivy fs ."],
  ])("%s runs the tool", (line) => {
    expect(
      detectTools({ image: null, script: [line] }, catalog.tools).map((t) => t.tool),
    ).toContain("trivy");
  });

  test("if command -v is not an execution", () => {
    expect(
      detectTools(
        { image: null, script: ["if command -v trivy >/dev/null; then echo y; fi"] },
        catalog.tools,
      ),
    ).toEqual([]);
  });

  test.each([
    ["echo sh -c trivy fs ."],
    ['git commit -m "fix: use sh -c trivy fs ."'],
    ['grep -r "run sh -c trivy fs ." .'],
    ["ls /bin/sh -c trivy fs ."],
    ["xargs grep sh -c trivy fs"],
    ["xargs -0 -n 1 grep trivy"],
    ["sh -s -- -c gitleaks"],
    ["bash -s gitleaks detect"],
    ["sh -es -- trivy fs ."],
  ])("%s runs nothing", (line) => {
    expect(detectTools({ image: null, script: [line] }, catalog.tools)).toEqual([]);
  });

  test.each([
    ['ssh -i key host "trivy fs ."'],
    ['su - bob -c "trivy fs ."'],
    ['find . -exec sh -c "trivy fs ." ;'],
    ['/bin/bash -c "trivy fs ."'],
    ["xargs trivy fs"],
    ["xargs -n1 trivy image"],
    ["xargs -I {} trivy image {}"],
    ["xargs --max-args=1 -P 4 trivy image"],
    ["cat images.txt | xargs -L 1 trivy image"],
  ])("%s runs the tool too", (line) => {
    expect(
      detectTools({ image: null, script: [line] }, catalog.tools).map((t) => t.tool),
    ).toContain("trivy");
  });

  test("a list of repeated options stays linear", () => {
    const started = performance.now();
    detectTools({ image: null, script: [`sh ${"-o ".repeat(20000)}`] }, catalog.tools);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test.each([
    ['docker build --label "note=sh -c trivy fs ." .'],
    ['docker exec app echo "run sh -c trivy fs ."'],
    ["sh -c 'echo gitleaks' arg"],
    ["su -c 'echo gitleaks' bob"],
    ["ssh -o StrictHostKeyChecking=no gitleaks uptime"],
  ])("%s does not run the quoted tool", (line) => {
    expect(detectTools({ image: null, script: [line] }, catalog.tools)).toEqual([]);
  });

  test("command runs, command -v queries", () => {
    const found = (line: string) =>
      detectTools({ image: null, script: [line] }, catalog.tools).map((entry) => entry.tool);
    expect(found("command trivy fs .")).toContain("trivy");
    expect(found("command -v trivy")).toEqual([]);
  });
});

describe("detection shell splitting", () => {
  const catalog = loadCatalog();
  const found = (line: string) =>
    detectTools({ image: null, script: [line] }, catalog.tools).map((entry) => entry.tool);

  test.each([
    ['echo "a; trivy fs ."'],
    ["true # trivy fs ."],
    ["# a && gitleaks detect"],
    ["git add renovate.json"],
    ["test -f renovate.json"],
    ["jq . renovate.json"],
    ["which gitleaks"],
    ["command -v gitleaks"],
    ["sudo cat renovate.json"],
    ["apt-get install -y trivy jq"],
    ["pip install semgrep pytest"],
    ['git commit -m "semgrep rule fix"'],
  ])("%s proves nothing", (line) => {
    expect(found(line)).toEqual([]);
  });

  test.each([
    ["trivy fs . && echo ok", "trivy"],
    ["echo ok; trivy fs .", "trivy"],
    ['bash -c "semgrep scan"', "semgrep"],
    ["sudo trivy fs .", "trivy"],
    ["export R=$(gitleaks detect)", "gitleaks"],
    ['echo "$(semgrep scan)"', "semgrep"],
    ["`trivy fs .`", "trivy"],
    ["kubectl exec p -- gitleaks detect", "gitleaks"],
    ["env A=1 trivy fs .", "trivy"],
  ])("%s names %s", (line, tool) => {
    expect(found(line)).toContain(tool);
  });
});

describe("detection shell splitting, quotes and heredocs", () => {
  const catalog = loadCatalog();
  const found = (line: string) =>
    detectTools({ image: null, script: [line] }, catalog.tools).map((entry) => entry.tool);

  test.each([
    ['echo $(echo ")"; trivy fs .)'],
    ["echo $(echo ')'; trivy fs .)"],
    ['echo "$(printf "%s" "(")" && trivy fs .'],
    ["cat <<EOF > a.txt\nit's ok\nEOF\necho 'x'; trivy fs ."],
    ["cat <<-'EOF'\n\tit's ok\n\tEOF\ntrivy fs ."],
    ["bash <<EOF\ntrivy fs .\nEOF"],
    ["! trivy fs ."],
    ["elif trivy fs .; then"],
    ["until trivy fs .; do sleep 1; done"],
    ["for t in a b; do trivy fs .; done"],
  ])("%s runs the tool", (line) => {
    expect(found(line)).toContain("trivy");
  });

  test.each([
    ["for t in trivy grype; do echo $t; done"],
    ["for t in trivy grype\ndo\n  echo $t\ndone"],
    ["if true; then echo; elif grep -q trivy f; then echo; fi"],
    ["! grep -q trivy f"],
    ["case $T in trivy) echo t ;; esac"],
    ["cat <<EOF\nrun trivy fs . now\nEOF"],
    ["cat << 'EOF' > notes.md\ngitleaks detect, it's fine\nEOF"],
  ])("%s runs nothing", (line) => {
    expect(found(line)).toEqual([]);
  });
});

describe("detection by GitHub actions", () => {
  const scanner = tool("scanner", {
    detect: { images: [], scripts: [], actions: ["acme/scan-action"] },
  });

  test("an action named by the entry designates the tool, ignoring case", () => {
    expect(
      detectTools({ image: null, script: [], actions: ["Acme/Scan-Action"] }, [scanner]),
    ).toEqual([{ tool: "scanner", layers: ["sast"] }]);
  });

  test("a sub-path of the action designates it too, another repository does not", () => {
    expect(
      detectTools({ image: null, script: [], actions: ["acme/scan-action/init"] }, [scanner]),
    ).toHaveLength(1);
    expect(
      detectTools({ image: null, script: [], actions: ["acme/scan-action-fork"] }, [scanner]),
    ).toEqual([]);
  });

  test.each([
    ["github/codeql-action/analyze", "codeql"],
    ["aquasecurity/trivy-action", "trivy"],
    ["gitleaks/gitleaks-action", "gitleaks"],
    ["semgrep/semgrep-action", "semgrep"],
    ["sigstore/cosign-installer", "cosign"],
    ["hashicorp/vault-action", "vault"],
  ])("real action %s is recognised as %s", (action, id) => {
    expect(
      detectTools({ image: null, script: [], actions: [action] }, tools).map((entry) => entry.tool),
    ).toContain(id);
  });
});
