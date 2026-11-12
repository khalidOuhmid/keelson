import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { loadCatalog, type Tool } from "../src/index.ts";
import { IMAGES, type ImageFacts } from "./images.ts";

const { tools } = loadCatalog();

/** Every word of these snippets is plain or `""`-quoted: no need for a shell parser. */
function words(command: string): string[] {
  return (command.match(/"[^"]*"|\S+/g) ?? []).map((word) =>
    word.startsWith('"') ? word.slice(1, -1) : word,
  );
}

const directory = (file: string): string => file.slice(0, file.lastIndexOf("/")) || "/";
const trimmed = (dir: string): string => (dir.length > 1 ? dir.replace(/\/$/, "") : dir);

function resolves(facts: ImageFacts, command: string): boolean {
  if (command.startsWith("/")) {
    return facts.files.includes(command);
  }
  return facts.files.some(
    (file) =>
      file.slice(file.lastIndexOf("/") + 1) === command &&
      facts.path.map(trimmed).includes(directory(file)),
  );
}

type GitlabJob = { image?: string | { name: string; entrypoint?: string[] }; script?: string[] };

type Run = { tool: string; image: string; entrypoint: string | null; args: string[] };

const VALUED = new Set(["-v", "-w", "-e", "--entrypoint"]);

function dockerRun(tool: string, line: string): Run | null {
  const all = words(line);
  if (all[0] !== "docker" || all[1] !== "run") {
    return null;
  }
  let entrypoint: string | null = null;
  let index = 2;
  while (index < all.length && (all[index] ?? "").startsWith("-")) {
    const option = all[index] ?? "";
    if (VALUED.has(option)) {
      if (option === "--entrypoint") {
        entrypoint = all[index + 1] ?? null;
      }
      index += 2;
    } else {
      index += 1;
    }
  }
  return { tool, image: all[index] ?? "", entrypoint, args: all.slice(index + 1) };
}

const gitlabJobs = tools.flatMap((tool) =>
  tool.snippets.gitlab === null
    ? []
    : Object.values(parseYaml(tool.snippets.gitlab) as Record<string, GitlabJob>).map((job) => ({
        tool: tool.id,
        image: typeof job.image === "string" ? job.image : (job.image?.name ?? null),
        entrypoint: typeof job.image === "object" ? (job.image.entrypoint ?? null) : null,
        commands: (job.script ?? []).map((line) => words(line)[0] ?? ""),
      })),
);

const githubRuns = (tool: Tool): string[] =>
  tool.snippets.github === null
    ? []
    : (parseYaml(tool.snippets.github) as { run?: string }[]).flatMap((step) =>
        step.run === undefined ? [] : [step.run],
      );

const dockerRuns = tools.flatMap((tool) =>
  githubRuns(tool).flatMap((line) => {
    const run = dockerRun(tool.id, line);
    return run === null ? [] : [run];
  }),
);

/** These snippets run on the runner's own image and assume the tool is installed there. The two
 *  uploads only need `curl`, which GitHub's hosted runners and GitLab.com's default image carry. */
const HOST_INSTALLED = [
  "defectdojo",
  "dependency-track",
  "detect-secrets",
  "garak",
  "kubescape",
  "lynis",
  "modelscan",
  "openscap",
  "promptfoo",
  "snyk",
  "witness",
];

describe("the snippets' images", () => {
  test("are all known, so that a new image gets checked before it ships", () => {
    const used = [
      ...gitlabJobs.flatMap((job) => (job.image === null ? [] : [job.image])),
      ...dockerRuns.map((run) => run.image),
    ];
    expect(used.filter((image) => !Object.hasOwn(IMAGES, image))).toEqual([]);
  });

  test("are missing only from the snippets that rely on an installed tool", () => {
    const imageless = [
      ...gitlabJobs.filter((job) => job.image === null).map((job) => job.tool),
      ...tools
        .filter((tool) => githubRuns(tool).some((line) => dockerRun(tool.id, line) === null))
        .map((tool) => tool.id),
    ];
    expect([...new Set(imageless)].sort()).toEqual(HOST_INSTALLED);
  });
});

describe("a GitLab snippet", () => {
  const imaged = gitlabJobs.filter((job) => job.image !== null);

  test("uses an image with a shell, which the runner needs to run a script", () => {
    expect(
      imaged.filter((job) => IMAGES[job.image ?? ""]?.shell === null).map((job) => job.tool),
    ).toEqual([]);
  });

  test("clears an image entrypoint that would receive the runner's shell, and only that one", () => {
    const wrong = imaged.filter((job) => {
      const facts = IMAGES[job.image ?? ""];
      const cleared = JSON.stringify(job.entrypoint) === JSON.stringify([""]);
      return facts?.runnerKeepsEntrypoint !== undefined
        ? cleared
        : facts?.entrypoint !== null && !cleared;
    });
    expect(wrong.map((job) => job.tool)).toEqual([]);
  });

  test("calls commands that are on the image's PATH or at their absolute path", () => {
    const missing = imaged.flatMap((job) => {
      const facts = IMAGES[job.image ?? ""];
      return facts === undefined
        ? []
        : job.commands
            .filter((command) => !resolves(facts, command))
            .map((command) => `${job.tool}: ${command}`);
    });
    expect(missing).toEqual([]);
  });

  test("exists for every tool whose image has a shell variant", () => {
    const withoutGitlab = tools.filter(
      (tool) => tool.kind === "job" && tool.snippets.gitlab === null,
    );
    expect(withoutGitlab.map((tool) => tool.id).sort()).toEqual(["codeql", "scorecard"]);
  });
});

describe("a GitHub docker run", () => {
  test("calls a command the image resolves, or hands its arguments to the entrypoint", () => {
    const broken = dockerRuns.filter((run) => {
      const facts = IMAGES[run.image];
      if (facts === undefined) {
        return false;
      }
      const command = run.args[0] ?? "";
      return (run.entrypoint === "" || facts.entrypoint === null) && !resolves(facts, command);
    });
    expect(broken.map((run) => `${run.tool}: ${run.args[0]}`)).toEqual([]);
  });

  test("keeps an entrypoint the tool depends on", () => {
    expect(
      dockerRuns
        .filter(
          (run) =>
            run.entrypoint !== null && IMAGES[run.image]?.dockerKeepsEntrypoint !== undefined,
        )
        .map((run) => run.tool),
    ).toEqual([]);
  });
});

describe("the static check itself", () => {
  const facts: ImageFacts = {
    entrypoint: ["/opa"],
    path: ["/usr/bin", "/"],
    shell: null,
    files: ["/opa", "/usr/share/x/bin/tool.sh"],
  };

  test("resolves a command through PATH, including the root directory", () => {
    expect(resolves(facts, "opa")).toBe(true);
  });

  test("does not resolve a command outside PATH unless it is written in full", () => {
    expect(resolves(facts, "tool.sh")).toBe(false);
    expect(resolves(facts, "/usr/share/x/bin/tool.sh")).toBe(true);
  });

  test("reads the options of docker run, then the image and its arguments", () => {
    expect(
      dockerRun("x", 'docker run --rm -t -v "$PWD:/src" -w /src --entrypoint "" img:1 a b'),
    ).toEqual({ tool: "x", image: "img:1", entrypoint: "", args: ["a", "b"] });
  });
});
