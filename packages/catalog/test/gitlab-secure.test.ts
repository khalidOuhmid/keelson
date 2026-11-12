import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseGitlab } from "@keelson/adapter-gitlab";
import { coverage, detectTools, loadCatalog, type Tool } from "../src/index.ts";

const { tools } = loadCatalog();

function qualified(id: string, image: string): Tool {
  return {
    id,
    name: id,
    kind: "job",
    layers: ["dast"],
    license: "MIT",
    homepage: "https://exemple.org",
    verifiedAt: "https://exemple.org",
    logo: null,
    integration: null,
    detect: { images: [image], scripts: [], actions: [] },
    snippets: { gitlab: null, github: null },
    lastVerified: "2026-11-04",
  };
}

const found = (image: string, among: readonly Tool[] = tools): string[] =>
  detectTools({ image, script: [] }, among).map((entry) => entry.tool);

describe("an image named with its registry", () => {
  const dast = qualified("dast-tool", "registry.example.org/security-products/dast");

  test("matches its full path, tag and case aside", () => {
    expect(found("Registry.Example.org/security-products/dast:6", [dast])).toEqual(["dast-tool"]);
  });

  test("matches a mirror that keeps its path", () => {
    expect(found("mirror.corp/security-products/dast:6", [dast])).toEqual(["dast-tool"]);
  });

  test("does not match another image with the same last name", () => {
    expect(found("mycorp/dast:1", [dast])).toEqual([]);
    expect(found("dast", [dast])).toEqual([]);
  });
});

describe("GitLab Secure analyzers", () => {
  test.each([
    ["$SECURE_ANALYZERS_PREFIX/dast:$DAST_VERSION$DAST_IMAGE_SUFFIX", "gitlab-dast"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitLab variable, written as in the file
    ["${SECURE_ANALYZERS_PREFIX}/secrets:7", "gitlab-secret-detection"],
    ["$CI_TEMPLATE_REGISTRY_HOST/security-products/gemnasium:6", "gitlab-dependency-scanning"],
    ["registry.gitlab.com/security-products/dependency-scanning:0", "gitlab-dependency-scanning"],
    ["$CS_ANALYZER_IMAGE$CS_IMAGE_SUFFIX", "gitlab-container-scanning"],
    [
      "$SECURE_ANALYZERS_PREFIX/$APISEC_IMAGE:$APISEC_VERSION$APISEC_IMAGE_SUFFIX",
      "gitlab-api-security",
    ],
    ["$SECURE_ANALYZERS_PREFIX/gitlab-advanced-sast:2", "gitlab-advanced-sast"],
  ])("%s is %s", (image, id) => {
    expect(found(image)).toContain(id);
  });

  test("the Semgrep and KICS analyzers run Semgrep and KICS", () => {
    expect(found("$SECURE_ANALYZERS_PREFIX/semgrep:6")).toEqual(["semgrep"]);
    expect(found("$SECURE_ANALYZERS_PREFIX/kics:7")).toEqual(["kics"]);
  });

  test("an unknown variable stays unresolved", () => {
    expect(found("$MY_PREFIX/dast:6")).toEqual([]);
  });

  test("the official Security/DAST template covers DAST", () => {
    const file = join(
      import.meta.dir,
      "..",
      "..",
      "adapter-gitlab",
      "test",
      "corpus",
      "gitlab-templates",
      "Security-DAST.gitlab-ci.yml",
    );
    const { pipeline } = parseGitlab(readFileSync(file, "utf8"));
    const dast = coverage(pipeline, tools).layers.find((entry) => entry.layer === "dast");
    expect(dast).toMatchObject({ covered: true, jobs: ["dast"] });
  });
});
