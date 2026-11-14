import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apply as applyGithub, parse as parseGithub } from "@keelson/adapter-github";
import { parse as parseGitlab } from "@keelson/adapter-gitlab";
import { LAYERS } from "@keelson/taxonomy";
import * as icons from "simple-icons";
import { parse as parseYaml } from "yaml";
import { detectTools, isOpenSource, lintCatalog, loadCatalog, parseTool } from "../src/index.ts";

const TOOLS_DIR = join(import.meta.dir, "..", "tools");
const files = readdirSync(TOOLS_DIR)
  .filter((name) => name.endsWith(".yaml"))
  .sort();
const { tools, logos } = loadCatalog();

const REQUIRED = [
  "defectdojo",
  "dependency-track",
  "nexus",
  "harbor",
  "artifactory",
  "vault",
  "sonarqube",
  "sentry",
  "falco",
];

describe("tools without an image", () => {
  const docs = readFileSync(join(import.meta.dir, "..", "..", "..", "docs", "configuration.md"), {
    encoding: "utf8",
  });
  const listed = /Today: ((?:`[\w-]+`(?:,\s+|\s+and\s+)?)+)\./.exec(docs)?.[1] ?? "";

  test("are named in the configuration docs, which say detection by image is impossible", () => {
    const imageless = tools
      .filter((tool) => tool.kind === "job" && tool.detect.images.length === 0)
      .map((tool) => tool.id)
      .sort();
    expect([...listed.matchAll(/`([\w-]+)`/g)].map((match) => match[1]).sort()).toEqual(imageless);
    const prose = docs.replace(/\s+/g, " ");
    expect(prose).toContain("cannot be detected by its image");
    expect(prose).toContain("assumes the tool is already installed");
  });

  test("have GitLab snippets that set no image, as the docs say", () => {
    const withImage = tools
      .filter((tool) => tool.detect.images.length === 0 && tool.snippets.gitlab !== null)
      .filter((tool) =>
        Object.values(parseYaml(tool.snippets.gitlab ?? "") as Record<string, object>).some(
          (job) => "image" in job,
        ),
      )
      .map((tool) => tool.id);
    expect(withImage).toEqual([]);
  });
});

describe("the bundled catalogue", () => {
  /** The JSON is committed: without this test, an entry changed without `catalog:build` would
   *  leave the binary serving the old version. */
  test("is exactly what the YAML entries say", () => {
    const parsed = files.map((name) => {
      const result = parseTool(readFileSync(join(TOOLS_DIR, name), "utf8"));
      if (!result.ok) {
        throw new Error(`${name}: ${result.detail}`);
      }
      return result.tool;
    });
    expect(tools).toEqual(parsed);
  });

  test("carries the exact simple-icons paths", () => {
    const bySlug = new Map(
      Object.values(icons as unknown as Record<string, { slug: string; path: string }>).map(
        (icon) => [icon.slug, icon.path],
      ),
    );
    for (const [slug, logo] of Object.entries(logos)) {
      expect({ slug, path: logo.path }).toEqual({ slug, path: bySlug.get(slug) ?? "" });
    }
  });

  test("contains between 50 and 100 tools, each in the file named after its id", () => {
    expect(tools.length).toBeGreaterThanOrEqual(50);
    expect(tools.length).toBeLessThanOrEqual(100);
    expect(tools.map((tool) => `${tool.id}.yaml`).sort()).toEqual(files);
  });

  test("contains the nine mandatory tools", () => {
    const ids = tools.map((tool) => tool.id);
    expect(REQUIRED.filter((id) => !ids.includes(id))).toEqual([]);
  });

  test("offers two tools per OWASP layer, one of them open source", () => {
    for (const layer of LAYERS.filter((entry) => entry.source === "owasp")) {
      const offering = tools.filter((tool) => tool.layers.includes(layer.id));
      expect({ layer: layer.id, enough: offering.length >= 2 }).toEqual({
        layer: layer.id,
        enough: true,
      });
      expect({ layer: layer.id, open: offering.some(isOpenSource) }).toEqual({
        layer: layer.id,
        open: true,
      });
    }
  });

  test("offers one tool per platform category", () => {
    for (const layer of LAYERS.filter((entry) => entry.source === "platform")) {
      expect({
        layer: layer.id,
        offered: tools.some((tool) => tool.layers.includes(layer.id)),
      }).toEqual({ layer: layer.id, offered: true });
    }
  });

  test("passes the lint without errors today", () => {
    const entries = files.map((name) => ({
      file: name,
      text: readFileSync(join(TOOLS_DIR, name), "utf8"),
    }));
    expect(lintCatalog(entries, logos, new Date("2026-11-14T00:00:00Z"))).toEqual([]);
  });
});

describe("snippets", () => {
  test("every GitHub snippet is a YAML list of steps", () => {
    for (const tool of tools.filter((entry) => entry.snippets.github !== null)) {
      const steps = parseYaml(tool.snippets.github ?? "") as { name?: unknown }[];
      expect({ tool: tool.id, list: Array.isArray(steps) && steps.length > 0 }).toEqual({
        tool: tool.id,
        list: true,
      });
    }
  });

  /** The invariant that ties both halves of an entry together: the proposed snippet must be
   *  recognised by the same tool's detection. Otherwise inserting a tool would leave its layer
   *  uncovered. */
  test("every GitHub snippet, inserted as a job, is detected as its own tool", () => {
    for (const tool of tools.filter((entry) => entry.snippets.github !== null)) {
      const base = parseGithub("on: push\n", { file: ".github/workflows/ci.yml" });
      const inserted = applyGithub(base.document, {
        v: 1,
        baseHash: base.hash,
        kind: "addSnippet",
        id: "added",
        stage: "",
        snippet: tool.snippets.github ?? "",
      });
      const job = inserted.ok ? inserted.value.pipeline.jobs[0] : undefined;
      const detected = job === undefined ? [] : detectTools(job.signals, tools).map((d) => d.tool);
      expect({ tool: tool.id, found: detected.includes(tool.id) }).toEqual({
        tool: tool.id,
        found: true,
      });
    }
  });

  test("every GitLab snippet parses and is detected as its own tool", () => {
    for (const tool of tools.filter((entry) => entry.snippets.gitlab !== null)) {
      const parsed = parseGitlab(tool.snippets.gitlab ?? "");
      expect({ tool: tool.id, codes: parsed.diagnostics.map((entry) => entry.code) }).toEqual({
        tool: tool.id,
        codes: [],
      });
      const job = parsed.pipeline.jobs[0];
      const detected = job === undefined ? [] : detectTools(job.signals, tools).map((d) => d.tool);
      expect({ tool: tool.id, found: detected.includes(tool.id) }).toEqual({
        tool: tool.id,
        found: true,
      });
    }
  });
});
