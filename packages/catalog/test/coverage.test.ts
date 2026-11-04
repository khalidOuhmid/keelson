import { describe, expect, test } from "bun:test";
import type { Job, Pipeline } from "@keelson/core";
import { coverage, detectTools, loadCatalog, type Tool } from "../src/index.ts";

const { tools } = loadCatalog();

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
    detect: { images: [`exemple/${id}`], scripts: [`\\b${id}\\b`] },
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

describe("détection", () => {
  test("sur l'image, sans tenir compte de la casse ni du tag", () => {
    expect(detectTools({ image: "Exemple/Outil:1.2", script: [] }, [tool("outil")])).toEqual([
      { tool: "outil", layers: ["sast"], via: "image" },
    ]);
  });

  test("sur le script", () => {
    expect(detectTools({ image: null, script: ["./run", "outil --x"] }, [tool("outil")])).toEqual([
      { tool: "outil", layers: ["sast"], via: "script" },
    ]);
  });

  test("l'image l'emporte sur le script", () => {
    expect(
      detectTools({ image: "exemple/outil", script: ["outil"] }, [tool("outil")])[0]?.via,
    ).toBe("image");
  });

  test("un mot qui contient le nom ne correspond pas", () => {
    expect(detectTools({ image: null, script: ["outillage"] }, [tool("outil")])).toEqual([]);
  });

  test("un job peut correspondre à plusieurs outils", () => {
    const found = detectTools({ image: null, script: ["a && b"] }, [tool("a"), tool("b")]);
    expect(found.map((entry) => entry.tool)).toEqual(["a", "b"]);
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

  test("un pipeline partiel rend une couverture partielle", () => {
    const unresolved = [{ form: "remote" as const, detail: "x", from: "a", range: null }];
    expect(coverage(pipeline([], unresolved), CATALOG).partial).toBe(true);
    expect(coverage(pipeline([]), CATALOG).partial).toBe(false);
  });
});
