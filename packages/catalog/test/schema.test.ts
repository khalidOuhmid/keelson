import { describe, expect, test } from "bun:test";
import { isOpenSource, lintCatalog, parseTool, type Tool } from "../src/index.ts";

const VALID = `id: outil
name: Outil
kind: job
layers: [sast]
license: MIT
homepage: https://exemple.org
verifiedAt: https://exemple.org/docs
logo: null
detect:
  images: [exemple/outil]
  scripts: ['\\boutil\\b']
snippets:
  gitlab: null
  github: |
    - run: outil
lastVerified: 2026-11-04
`;

const NOW = new Date("2026-11-04T00:00:00Z");

function codes(text: string, logos = {}, now = NOW): string[] {
  return lintCatalog([{ file: "outil.yaml", text }], logos, now).map((entry) => entry.code);
}

describe("catalogue entry schema", () => {
  test("a valid entry passes", () => {
    expect(parseTool(VALID).ok).toBe(true);
    expect(codes(VALID)).toEqual([]);
  });

  test.each([
    ["an unknown layer", "layers: [sast]", "layers: [inventee]", "layers.0"],
    ["an unknown license", "license: MIT", "license: WTFPL", "license"],
    ["an uppercase id", "id: outil", "id: Outil", "id"],
    [
      "an unknown integration",
      "lastVerified: 2026-11-04",
      "integration: deploy\nlastVerified: 2026-11-04",
      "integration",
    ],
    [
      "an integration on a job tool",
      "lastVerified: 2026-11-04",
      "integration: push\nlastVerified: 2026-11-04",
      "integration",
    ],
    ["an invalid date", "lastVerified: 2026-11-04", "lastVerified: hier", "lastVerified"],
    ["an invalid URL", "homepage: https://exemple.org", "homepage: exemple", "homepage"],
    ["an invalid regex", "'\\boutil\\b'", "'('", "detect.scripts.0"],
    ["an unknown field", "kind: job", "kind: job\nextra: 1", ""],
  ])("rejects %s", (_label, from, to, path) => {
    const parsed = parseTool(VALID.replace(from, to));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.detail).toContain(path);
  });

  test("unreadable YAML returns a detail and does not throw", () => {
    expect(parseTool("a: [").ok).toBe(false);
  });
});

describe("catalogue lint", () => {
  test("an invalid entry is a named error", () => {
    expect(codes("id: X")).toEqual(["CATALOG_INVALID_TOOL"]);
  });

  test("a logo missing from the catalogue is an error", () => {
    const text = VALID.replace("logo: null", "logo: inconnu");
    expect(codes(text)).toEqual(["CATALOG_UNKNOWN_LOGO"]);
    expect(codes(text, { inconnu: { path: "M0 0" } })).toEqual([]);
  });

  test("a job tool without any snippet is an error, a service is not", () => {
    const empty = VALID.replace("github: |\n    - run: outil", "github: null");
    expect(codes(empty)).toEqual(["CATALOG_MISSING_SNIPPET"]);
    expect(codes(empty.replace("kind: job", "kind: service"))).toEqual([]);
  });

  test("a duplicate id is an error", () => {
    const found = lintCatalog(
      [
        { file: "a.yaml", text: VALID },
        { file: "b.yaml", text: VALID },
      ],
      {},
      NOW,
    );
    expect(found.map((entry) => [entry.code, entry.file])).toEqual([
      ["CATALOG_DUPLICATE_TOOL", "b.yaml"],
    ]);
  });

  test("freshness flips at exactly six months, as a warning", () => {
    const aged = VALID.replace("lastVerified: 2026-11-04", "lastVerified: 2026-05-04");
    expect(codes(aged)).toEqual([]);
    const older = VALID.replace("lastVerified: 2026-11-04", "lastVerified: 2026-05-03");
    const found = lintCatalog([{ file: "o.yaml", text: older }], {}, NOW);
    expect(found.map((entry) => [entry.code, entry.severity])).toEqual([
      ["CATALOG_STALE_TOOL", "warning"],
    ]);
  });
});

describe("a verification date in the future", () => {
  test("is an error, the same day is not", () => {
    expect(codes(VALID)).toEqual([]);
    const ahead = VALID.replace("lastVerified: 2026-11-04", "lastVerified: 2026-11-05");
    const found = lintCatalog([{ file: "f.yaml", text: ahead }], {}, NOW);
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe("CATALOG_FUTURE_VERIFIED");
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.params as unknown).toEqual({ tool: "outil", lastVerified: "2026-11-05" });
  });
});

describe("licenses", () => {
  test("only open source licenses count as such", () => {
    const of = (license: Tool["license"]) => isOpenSource({ license });
    expect(of("MIT")).toBe(true);
    expect(of("AGPL-3.0-only")).toBe(true);
    expect(of("BUSL-1.1")).toBe(false);
    expect(of("FSL-1.1-Apache-2.0")).toBe(false);
    expect(of("Proprietary")).toBe(false);
  });
});

describe("snippets are checked at parse time", () => {
  test.each([
    ["an unreadable GitLab snippet", "gitlab: null", 'gitlab: "a: ["', "snippets.gitlab"],
    ["a GitLab snippet that is not a map", "gitlab: null", 'gitlab: "- a"', "snippets.gitlab"],
    [
      "a GitHub snippet that is not a list",
      "github: |\n    - run: outil",
      'github: "a: b"',
      "snippets.github",
    ],
  ])("rejects %s", (_label, from, to, path) => {
    const parsed = parseTool(VALID.replace(from, to));
    expect(parsed.ok ? "" : parsed.detail).toContain(path);
    expect(parsed.ok).toBe(false);
  });
});
