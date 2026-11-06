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

describe("intégrations détectées", () => {
  const service = tool("nexus", { kind: "service", integration: "push" });

  test("le script d'un job nomme un service qui porte une intégration", () => {
    expect(detectIntegrations({ image: null, script: ["nexus upload"] }, [service])).toEqual([
      { tool: "nexus", kind: "push" },
    ]);
  });

  test("l'image seule ne prouve pas l'intégration", () => {
    expect(detectIntegrations({ image: "exemple/nexus", script: [] }, [service])).toEqual([]);
  });

  test("un outil sans intégration ne propose rien", () => {
    expect(detectIntegrations({ image: null, script: ["trivy"] }, [tool("trivy")])).toEqual([]);
  });

  test("un service couvre une couche, et le résultat le nomme", () => {
    const result = coverage(
      pipeline([]),
      [tool("gitea", { kind: "service", layers: ["scm"] })],
      {},
      [],
      [{ id: "git", tool: "gitea", url: null, environment: null }],
    );
    const entry = result.layers.find((layer) => layer.layer === "scm");
    expect(entry).toEqual({ layer: "scm", covered: true, jobs: [], services: ["git"] });
  });

  test("un service dont l'outil est inconnu ne couvre rien", () => {
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

describe("les fiches réelles", () => {
  test("les outils de plateforme obligatoires disent leur intégration", () => {
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
  ])("le script %s nomme %s", (line, tool) => {
    expect(found({ image: null, script: [line] })).toContain(tool);
  });

  test.each([
    "zaproxy/zap-stable:2.15",
    "zaproxy/zap-weekly",
    "ghcr.io/zaproxy/zaproxy:stable",
    "owasp/zap2docker-stable",
  ])("l'image officielle %s est ZAP", (image) => {
    expect(found({ image, script: [] })).toContain("zap");
  });

  test("le script d'un snippet ne revendique que les couches de sa fiche", () => {
    const foreign = catalog.tools.flatMap((tool) => {
      const snippet = tool.snippets.gitlab;
      if (snippet === null) {
        return [];
      }
      const jobs = parseYaml(snippet) as Record<string, { script?: string[] }>;
      const script = Object.values(jobs).flatMap((job) => job.script ?? []);
      return detectTools({ image: null, script }, catalog.tools)
        .filter((entry) => entry.layers.some((layer) => !tool.layers.includes(layer)))
        .map((entry) => `${tool.id} détecte ${entry.tool}`);
    });
    expect(foreign).toEqual([]);
  });

  test("un mot dans une chaîne n'est pas une commande", () => {
    expect(
      found({ image: null, script: ['curl -F scan_type="Trivy Scan" https://x'] }),
    ).not.toContain("trivy");
  });

  test("chaque image de snippet GitLab est reconnue par sa propre fiche", () => {
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

describe("détection", () => {
  test("sur l'image, sans tenir compte de la casse ni du tag", () => {
    expect(detectTools({ image: "Exemple/Outil:1.2", script: [] }, [tool("outil")])).toEqual([
      { tool: "outil", layers: ["sast"] },
    ]);
  });

  test("sur le script", () => {
    expect(detectTools({ image: null, script: ["./run", "outil --x"] }, [tool("outil")])).toEqual([
      { tool: "outil", layers: ["sast"] },
    ]);
  });

  test("un mot qui contient le nom ne correspond pas", () => {
    expect(detectTools({ image: null, script: ["outillage"] }, [tool("outil")])).toEqual([]);
  });

  test("un job peut correspondre à plusieurs outils", () => {
    const found = detectTools({ image: null, script: ["a && b"] }, [tool("a"), tool("b")]);
    expect(found.map((entry) => entry.tool)).toEqual(["a", "b"]);
  });

  test("le script ne tient pas compte de la casse", () => {
    expect(detectTools({ image: null, script: ["OUTIL --x"] }, [tool("outil")])).toHaveLength(1);
  });

  test("un miroir ou un registre privé reste la même image", () => {
    const found = (image: string) =>
      detectTools({ image, script: [] }, [
        tool("trivy", { detect: { images: ["aquasec/trivy"], scripts: [], actions: [] } }),
      ]);
    expect(found("ghcr.io/aquasecurity/trivy:0.5")).toHaveLength(1);
    expect(found("registry.example.org:5000/mirror/trivy@sha256:abc")).toHaveLength(1);
    expect(found("mycorp/trivy-report-uploader")).toEqual([]);
  });

  /** Sur le vrai catalogue, parce que les faux positifs viennent de ses regex et non du moteur. */
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

describe("couverture", () => {
  const CATALOG = [tool("a", { layers: ["sast", "sca"] }), tool("b", { layers: ["dast"] })];

  test("une couche couverte nomme ses jobs, et les autres sont listées non couvertes", () => {
    const result = coverage(pipeline([job("x", null, ["a"]), job("y", null, ["a"])]), CATALOG);
    expect(result.layers.find((entry) => entry.layer === "sast")).toEqual({
      layer: "sast",
      covered: true,
      jobs: ["x", "y"],
      services: [],
    });
    expect(result.layers.find((entry) => entry.layer === "dast")?.covered).toBe(false);
    expect(result.layers).toHaveLength(21);
  });

  test("chaque job porte ses couches et ses outils", () => {
    expect(coverage(pipeline([job("x", null, ["a"])]), CATALOG).jobs).toEqual([
      { job: "x", layers: ["sca", "sast"], tools: ["a"], overridden: false },
    ]);
  });

  test("une surcharge remplace la détection, l'outil détecté reste nommé", () => {
    const result = coverage(pipeline([job("x", null, ["a"])]), CATALOG, { x: ["dast"] });
    expect(result.jobs[0]).toEqual({
      job: "x",
      layers: ["dast"],
      tools: ["a"],
      overridden: true,
    });
    expect(result.layers.find((entry) => entry.layer === "sast")?.covered).toBe(false);
  });

  test("une surcharge vide neutralise un faux positif", () => {
    const result = coverage(pipeline([job("x", null, ["a"])]), CATALOG, { x: [] });
    expect(result.jobs[0]?.layers).toEqual([]);
  });

  test("une surcharge s'applique à un job sans détection", () => {
    const result = coverage(pipeline([job("x", null)]), CATALOG, { x: ["iast"] });
    expect(result.layers.find((entry) => entry.layer === "iast")?.jobs).toEqual(["x"]);
  });

  test("une clé héritée d'Object n'est pas une surcharge", () => {
    expect(coverage(pipeline([job("constructor", null)]), CATALOG).jobs[0]?.overridden).toBe(false);
  });

  test("un fichier illisible rend aussi la couverture partielle", () => {
    const broken = [
      { code: "INVALID_YAML", severity: "error", params: { detail: "x" }, range: null, file: "a" },
    ] as const;
    expect(coverage(pipeline([]), CATALOG, {}, [...broken]).partial).toBe(true);
  });

  test("un pipeline partiel rend une couverture partielle", () => {
    const unresolved = [{ form: "remote" as const, detail: "x", from: "a", range: null }];
    expect(coverage(pipeline([], unresolved), CATALOG).partial).toBe(true);
    expect(coverage(pipeline([]), CATALOG).partial).toBe(false);
  });
});

describe("deux workflows, un même nom de job", () => {
  test("une couche ne nomme le job qu'une fois", () => {
    const twice = [job("x", null, ["a"]), job("x", null, ["a"])];
    const entry = coverage(pipeline(twice), [
      tool("a", { detect: { images: [], scripts: ["\\ba\\b"], actions: [] } }),
    ]).layers.find((layer) => layer.layer === "sast");
    expect(entry?.jobs).toEqual(["x"]);
  });
});

describe("actions GitHub", () => {
  const catalog = loadCatalog();
  const found = (signals: { image: string | null; actions: string[] }) =>
    detectTools({ ...signals, script: [] }, catalog.tools).map((entry) => entry.tool);

  test("envoyer un SARIF n'est pas analyser", () => {
    expect(found({ image: null, actions: ["github/codeql-action/upload-sarif@v3"] })).toEqual([]);
    expect(found({ image: null, actions: ["github/codeql-action/analyze@v3"] })).toContain(
      "codeql",
    );
  });

  test("un docker:// compte comme une image, même derrière un container", () => {
    expect(found({ image: "node:20", actions: ["docker://aquasec/trivy"] })).toContain("trivy");
  });
});

describe("découpage shell sur une entrée hostile", () => {
  const catalog = loadCatalog();
  test.each([
    ["$( imbriqués", "$(".repeat(5000)],
    ["sh -c imbriqués", "bash -c ".repeat(5000)],
    ["kubectl exec imbriqués", "kubectl exec a -- ".repeat(5000)],
    ["une ligne immense", "a ".repeat(500000)],
  ])("%s ne plante pas et reste rapide", (_label, line) => {
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
  ])("%s lance l'outil", (line) => {
    expect(
      detectTools({ image: null, script: [line] }, catalog.tools).map((t) => t.tool),
    ).toContain("trivy");
  });

  test("if command -v n'est pas une exécution", () => {
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
  ])("%s ne lance rien", (line) => {
    expect(detectTools({ image: null, script: [line] }, catalog.tools)).toEqual([]);
  });

  test.each([
    ['ssh -i key host "trivy fs ."'],
    ['su - bob -c "trivy fs ."'],
    ['find . -exec sh -c "trivy fs ." ;'],
    ['/bin/bash -c "trivy fs ."'],
  ])("%s lance l'outil aussi", (line) => {
    expect(
      detectTools({ image: null, script: [line] }, catalog.tools).map((t) => t.tool),
    ).toContain("trivy");
  });

  test("une liste d'options répétées reste linéaire", () => {
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
  ])("%s ne lance pas l'outil cité", (line) => {
    expect(detectTools({ image: null, script: [line] }, catalog.tools)).toEqual([]);
  });

  test("command lance, command -v interroge", () => {
    const found = (line: string) =>
      detectTools({ image: null, script: [line] }, catalog.tools).map((entry) => entry.tool);
    expect(found("command trivy fs .")).toContain("trivy");
    expect(found("command -v trivy")).toEqual([]);
  });
});

describe("découpage shell de la détection", () => {
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
  ])("%s ne prouve rien", (line) => {
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
  ])("%s nomme %s", (line, tool) => {
    expect(found(line)).toContain(tool);
  });
});
