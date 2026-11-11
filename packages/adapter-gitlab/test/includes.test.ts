import { describe, expect, test } from "bun:test";
import {
  EXTENDS_TARGET_NOT_FOUND,
  INCLUDE_CYCLE,
  INCLUDE_LIMIT_EXCEEDED,
  INCLUDE_NOT_FOUND,
  INCLUDE_UNRESOLVED,
  isPartial,
} from "@keelson/core";
import {
  type IncludeReader,
  MAX_INCLUDED_FILES,
  matchesWildcard,
  normaliseIncludePath,
  parseIncludedFile,
  resolveIncludes,
} from "../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../src/parse.ts";

/** A literal repository. The whole module is tested this way: no write to disk, hence no test
 *  that passes because a stray file is lying around. */
function reader(files: Record<string, string>): IncludeReader {
  return {
    read: (path) => files[path] ?? null,
    candidates: () => Object.keys(files),
  };
}

function parseTree(files: Record<string, string>, main = GITLAB_CI_FILE) {
  const text = files[main];
  if (text === undefined) {
    throw new Error(`the tree has no ${main}`);
  }
  return parse(text, { file: main, read: reader(files) });
}

function codes(files: Record<string, string>): string[] {
  return parseTree(files).diagnostics.map((diagnostic) => diagnostic.code);
}

function jobIds(files: Record<string, string>): string[] {
  return parseTree(files).pipeline.jobs.map((job) => job.id);
}

const JOB = (id: string, stage: string): string =>
  [`${id}:`, `  stage: ${stage}`, "  script:", "    - make", ""].join("\n");

describe("include path normalisation", () => {
  test("the leading / is optional: GitLab counts from the repository root", () => {
    expect(normaliseIncludePath("/ci/jobs.yml")).toEqual({ ok: true, path: "ci/jobs.yml" });
    expect(normaliseIncludePath("ci/jobs.yml")).toEqual({ ok: true, path: "ci/jobs.yml" });
  });

  test("empty segments and “.” are collapsed", () => {
    expect(normaliseIncludePath("//ci//./jobs.yml")).toEqual({ ok: true, path: "ci/jobs.yml" });
  });

  test("a path that leaves the root is refused before any read", () => {
    expect(normaliseIncludePath("../../etc/passwd")).toEqual({
      ok: false,
      reason: "outsideRoot",
      path: "../../etc/passwd",
    });
    expect(normaliseIncludePath("ci/../../secret.yml")).toEqual({
      ok: false,
      reason: "outsideRoot",
      path: "ci/../../secret.yml",
    });
  });

  test("a backslash does not bypass the check", () => {
    expect(normaliseIncludePath("..\\..\\etc\\passwd.yml")).toEqual({
      ok: false,
      reason: "outsideRoot",
      path: "..\\..\\etc\\passwd.yml",
    });
  });

  test("GitLab requires .yml or .yaml", () => {
    expect(normaliseIncludePath("ci/jobs.yaml").ok).toBe(true);
    expect(normaliseIncludePath("ci/jobs.txt")).toEqual({
      ok: false,
      reason: "notYaml",
      path: "ci/jobs.txt",
    });
  });

  test("an empty path is refused", () => {
    expect(normaliseIncludePath("/").ok).toBe(false);
  });
});

describe("wildcards", () => {
  /** The three examples from the GitLab documentation, both ways: what matches and what does
   *  not. Without the second half, a pattern translated to `.*` would pass everywhere. */
  test("* does not cross a separator", () => {
    expect(matchesWildcard("configs/*.yml", "configs/a.yml")).toBe(true);
    expect(matchesWildcard("configs/*.yml", "configs/sub/a.yml")).toBe(false);
  });

  test("** crosses separators, including zero", () => {
    expect(matchesWildcard("configs/**.yml", "configs/a.yml")).toBe(true);
    expect(matchesWildcard("configs/**.yml", "configs/sub/a.yml")).toBe(true);
    expect(matchesWildcard("configs/**.yml", "other/a.yml")).toBe(false);
  });

  test("**/ * .yml takes only the subfolders", () => {
    expect(matchesWildcard("configs/**/*.yml", "configs/sub/a.yml")).toBe(true);
    expect(matchesWildcard("configs/**/*.yml", "configs/a.yml")).toBe(false);
  });

  test("the dot in a pattern is a literal dot, not a regex wildcard", () => {
    expect(matchesWildcard("ci/jobs.yml", "ci/jobsXyml")).toBe(false);
  });
});

describe("resolution", () => {
  test("a simple local include brings its jobs", () => {
    expect(
      jobIds({
        [GITLAB_CI_FILE]: ["include: ci/jobs.yml", "", "stages:", "  - build", ""].join("\n"),
        "ci/jobs.yml": JOB("compile", "build"),
      }),
    ).toEqual(["compile"]);
  });

  test("a nested include is resolved recursively", () => {
    expect(
      jobIds({
        [GITLAB_CI_FILE]: "include: ci/a.yml\n",
        "ci/a.yml": `include: ci/b.yml\n\n${JOB("from-a", "build")}`,
        "ci/b.yml": JOB("from-b", "build"),
      }),
    ).toEqual(["from-b", "from-a"]);
  });

  test("a list mixing forms resolves the local ones and reports the remote ones", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - ci/a.yml",
        "  - local: /ci/b.yml",
        "  - template: Jobs/SAST.gitlab-ci.yml",
        "  - remote: https://example/ci.yml",
        "",
      ].join("\n"),
      "ci/a.yml": JOB("a", "build"),
      "ci/b.yml": JOB("b", "build"),
    });

    expect(parsed.pipeline.jobs.map((job) => job.id)).toEqual(["a", "b"]);
    expect(parsed.pipeline.unresolved.map((entry) => entry.form)).toEqual(["template", "remote"]);
    expect(isPartial(parsed.pipeline)).toBe(true);
  });

  test("a pipeline whose includes are all resolved is not partial", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": JOB("a", "build"),
    });
    expect(isPartial(parsed.pipeline)).toBe(false);
    expect(parsed.pipeline.unresolved).toEqual([]);
  });

  test("the main file comes last in the merge order", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": `include: ci/b.yml\n`,
      "ci/b.yml": "",
    });
    expect(parsed.pipeline.files).toEqual(["ci/b.yml", "ci/a.yml", GITLAB_CI_FILE]);
  });

  test("a file included twice enters twice: GitLab does not deduplicate", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - ci/a.yml", "  - ci/a.yml", ""].join("\n"),
      "ci/a.yml": JOB("a", "build"),
    });
    expect(parsed.pipeline.files).toEqual(["ci/a.yml", "ci/a.yml", GITLAB_CI_FILE]);
    expect(parsed.pipeline.jobs.map((job) => job.id)).toEqual(["a"]);
  });

  test("a file included several times is read and parsed once per resolution", () => {
    const files: Record<string, string> = {
      [GITLAB_CI_FILE]: ["include:", "  - ci/a.yml", "  - ci/b.yml", "  - ci/a.yml", ""].join("\n"),
      "ci/a.yml": "include: ci/common.yml\n",
      "ci/b.yml": "include: ci/common.yml\n",
      "ci/common.yml": JOB("common", "build"),
    };
    const reads: string[] = [];
    const read: IncludeReader = {
      read: (path) => {
        reads.push(path);
        return files[path] ?? null;
      },
      candidates: () => Object.keys(files),
    };
    const main = parseIncludedFile(GITLAB_CI_FILE, files[GITLAB_CI_FILE] ?? "");
    const resolution = resolveIncludes(main, read);

    expect(resolution.files.map((file) => file.file)).toEqual([
      "ci/common.yml",
      "ci/a.yml",
      "ci/common.yml",
      "ci/b.yml",
      "ci/common.yml",
      "ci/a.yml",
    ]);
    expect(reads.toSorted()).toEqual(["ci/a.yml", "ci/b.yml", "ci/common.yml"]);
    const commons = resolution.files.filter((file) => file.file === "ci/common.yml");
    expect(new Set(commons).size).toBe(1);
  });

  test("a cycle is reported and resolution completes", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": "include: .gitlab-ci.yml\n",
    });

    const cycle = parsed.diagnostics.find((entry) => entry.code === INCLUDE_CYCLE);
    expect(cycle?.params).toEqual({ trail: [GITLAB_CI_FILE, "ci/a.yml", GITLAB_CI_FILE] });
    expect(cycle?.file).toBe("ci/a.yml");
  });

  test("a missing file is reported with its normalised path", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: "include: /ci/absent.yml\n" });
    const found = parsed.diagnostics.find((entry) => entry.code === INCLUDE_NOT_FOUND);
    expect(found?.params).toEqual({ reason: "missing", path: "ci/absent.yml" });
    expect(found?.severity).toBe("error");
  });

  test("an unreadable include entry is reported and does not stop the others", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - 42", "  - ci/a.yml", ""].join("\n"),
      "ci/a.yml": JOB("a", "build"),
    });
    expect(parsed.diagnostics.find((entry) => entry.code === INCLUDE_NOT_FOUND)?.params).toEqual({
      reason: "malformed",
    });
    expect(parsed.pipeline.jobs.map((job) => job.id)).toEqual(["a"]);
  });

  test("a wildcard takes files in lexicographic order", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: configs/*.yml\n",
      "configs/c.yml": JOB("c", "build"),
      "configs/a.yml": JOB("a", "build"),
      "configs/b.yml": JOB("b", "build"),
      "configs/sub/z.yml": JOB("z", "build"),
    });
    // `configs/sub/z.yml` is excluded: `*` does not cross a separator.
    expect(parsed.pipeline.files).toEqual([
      "configs/a.yml",
      "configs/b.yml",
      "configs/c.yml",
      GITLAB_CI_FILE,
    ]);
  });

  test("the included-file limit stops resolution", () => {
    const files: Record<string, string> = {
      [GITLAB_CI_FILE]: "include: ci/f0.yml\n",
    };
    const total = MAX_INCLUDED_FILES + 5;
    for (let index = 0; index < total; index += 1) {
      const next = index + 1 < total ? `include: ci/f${index + 1}.yml\n\n` : "";
      files[`ci/f${index}.yml`] = `${next}${JOB(`j${index}`, "build")}`;
    }

    const parsed = parse(files[GITLAB_CI_FILE] ?? "", {
      file: GITLAB_CI_FILE,
      read: reader(files),
    });
    expect(
      parsed.diagnostics.filter((entry) => entry.code === INCLUDE_LIMIT_EXCEEDED),
    ).toHaveLength(1);
    // The main file is always in the list: the limit bounds the included files, not it.
    expect(parsed.pipeline.files.length).toBe(MAX_INCLUDED_FILES + 1);
  });

  test("without a reader, a local include is unresolved and not missing", () => {
    const text = "include: ci/jobs.yml\n";
    const parsed = parse(text, { file: GITLAB_CI_FILE });

    expect(parsed.pipeline.unresolved).toEqual([
      { form: "local", detail: "ci/jobs.yml", from: GITLAB_CI_FILE, range: { start: 9, end: 20 } },
    ]);
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([INCLUDE_UNRESOLVED]);
  });
});

describe("merging definitions", () => {
  test("the main file overrides a job coming from an include", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        "compile:",
        "  stage: test",
        "",
      ].join("\n"),
      "ci/jobs.yml": JOB("compile", "build"),
    });

    const compile = parsed.pipeline.jobs.find((job) => job.id === "compile");
    expect(compile?.stage.value).toBe("test");
    // Overridden in the main file, so the main file owns it, so it stays editable.
    expect(compile?.file).toBe(GITLAB_CI_FILE);
    // The `script` still comes from the include: nothing is lost by the override.
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([]);
  });

  test("a job that is only in an include belongs to that file", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include: ci/jobs.yml", "", "stages:", "  - build", ""].join("\n"),
      "ci/jobs.yml": JOB("compile", "build"),
    });
    expect(parsed.pipeline.jobs[0]?.file).toBe("ci/jobs.yml");
  });

  test("between two includes, the last one wins", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - ci/a.yml",
        "  - ci/b.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
      ].join("\n"),
      "ci/a.yml": JOB("compile", "build"),
      "ci/b.yml": JOB("compile", "test"),
    });

    const compile = parsed.pipeline.jobs[0];
    expect(compile?.stage.value).toBe("test");
    expect(compile?.file).toBe("ci/b.yml");
  });

  test("a value inherited from an include carries its file in its origin", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "",
        "compile:",
        "  script:",
        "    - make other",
        "",
      ].join("\n"),
      "ci/jobs.yml": JOB("compile", "build"),
    });

    expect(parsed.pipeline.jobs[0]?.stage.origin).toEqual({
      kind: "include",
      file: "ci/jobs.yml",
    });
  });

  test("a stages list declared in an include is used as is", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/stages.yml\n",
      "ci/stages.yml": ["stages:", "  - prepare", "  - deliver", ""].join("\n"),
    });

    expect(parsed.pipeline.stages.map((stage) => stage.name)).toEqual(["prepare", "deliver"]);
    expect(parsed.pipeline.stages.every((stage) => stage.file === "ci/stages.yml")).toBe(true);
  });

  test("a stages list in the main file overrides the include's, it does not add to it", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include: ci/stages.yml", "", "stages:", "  - unique", ""].join("\n"),
      "ci/stages.yml": ["stages:", "  - prepare", "  - deliver", ""].join("\n"),
    });
    expect(parsed.pipeline.stages.map((stage) => stage.name)).toEqual(["unique"]);
  });

  test("an extends crosses files", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/templates.yml",
        "",
        "stages:",
        "  - build",
        "",
        "compile:",
        "  extends: .base",
        "  script:",
        "    - make",
        "",
      ].join("\n"),
      "ci/templates.yml": [".base:", "  stage: build", ""].join("\n"),
    });

    expect(parsed.diagnostics.filter((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)).toEqual(
      [],
    );
    expect(parsed.pipeline.jobs[0]?.stage).toEqual({
      value: "build",
      origin: { kind: "include", file: "ci/templates.yml" },
    });
    expect(parsed.pipeline.templates[0]).toMatchObject({
      id: ".base",
      file: "ci/templates.yml",
    });
  });
});

describe("severity of EXTENDS_TARGET_NOT_FOUND", () => {
  const MAIN_WITH_ORPHAN = [
    "stages:",
    "  - build",
    "",
    "orphan:",
    "  extends: .absent",
    "  script:",
    "    - make",
    "",
  ].join("\n");

  /** This is the gap of 2026-10-20: the missing target was downgraded to a warning as soon as an
   *  `include` key existed, which masked real errors. The downgrade now follows **unresolved**
   *  includes, not the presence of the key. */
  test("all includes resolved: the error regains its severity", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: `include: ci/empty.yml\n\n${MAIN_WITH_ORPHAN}`,
      "ci/empty.yml": "variables:\n  A: 1\n",
    });

    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("error");
  });

  test("an unresolved remote include may explain the absence: warning", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: `include:\n  - template: Jobs/SAST.gitlab-ci.yml\n\n${MAIN_WITH_ORPHAN}`,
    });

    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("warning");
  });

  /** A broken local include hides nothing unknown: its cause is already a named error, to be
   *  fixed. Downgrading it would replace a fact with a hypothesis. This only holds because the
   *  severity follows includes **not looked up or out of reach**, and not `Pipeline.unresolved`,
   *  which also counts the broken ones because they are missing from the screen. */
  test("a broken local include, alone: error", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: `include: /ci/absent.yml\n\n${MAIN_WITH_ORPHAN}`,
    });

    expect(isPartial(parsed.pipeline)).toBe(true);
    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("error");
  });

  test("a broken local include next to a remote one: warning, the remote one stays unknown", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - /ci/absent.yml",
        "  - template: Jobs/SAST.gitlab-ci.yml",
        "",
        MAIN_WITH_ORPHAN,
      ].join("\n"),
    });

    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("warning");
  });

  test("without a reader: warning, the local one is not broken, it was not looked up", () => {
    const parsed = parse(`include: /ci/jobs.yml\n\n${MAIN_WITH_ORPHAN}`);
    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("warning");
  });

  test("no include at all: error, as before this milestone", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: MAIN_WITH_ORPHAN });
    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("error");
  });
});

describe("diagnostics attributed to the right file", () => {
  test("a job without script in an include is blamed on the include", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include: ci/jobs.yml", "", "stages:", "  - build", ""].join("\n"),
      "ci/jobs.yml": ["silent:", "  stage: build", ""].join("\n"),
    });

    const found = parsed.diagnostics.find((entry) => entry.code === "JOB_WITHOUT_SCRIPT");
    expect(found?.file).toBe("ci/jobs.yml");

    /* The range is an offset into the text of **this** file, and the assertion **slices** it. The
       first version wrote `expect(range ? "silent:" : "").toBe("silent:")`: a ternary that returned
       the expected literal string as soon as the range existed, so it read no byte and its
       comment overstated everything it protected. Found by the independent review of
       2026-10-23, which defeated it with an absurd range. */
    const range = found?.range;
    if (range === null || range === undefined) {
      throw new Error("JOB_WITHOUT_SCRIPT without a range");
    }
    const included = parsed.pipeline.files.includes("ci/jobs.yml")
      ? "silent:\n  stage: build\n"
      : "";
    expect(included.slice(range.start, range.end)).toStartWith("silent:");
  });

  test("invalid YAML in an include is reported with its file", () => {
    expect(
      codes({
        [GITLAB_CI_FILE]: "include: ci/broken.yml\n",
        "ci/broken.yml": "a:\n  - x\n bad: [1,\n",
      }),
    ).toContain("INVALID_YAML");

    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/broken.yml\n",
      "ci/broken.yml": "a:\n  - x\n bad: [1,\n",
    });
    expect(
      parsed.diagnostics
        .filter((entry) => entry.code === "INVALID_YAML")
        .every((entry) => entry.file === "ci/broken.yml"),
    ).toBe(true);
  });
});

describe("a broken local include makes the pipeline partial", () => {
  /** Found by the `critique` pass of 2026-10-23, on the milestone's own golden: the `missing`
   *  tree returned `jobs: []` and `unresolved: []`, so `isPartial()` was **false** on the most
   *  common defect of a real repository — a typo in an include path. The partial pipeline banner
   *  did not show, and the screen suggested the pipeline was complete while it lacked everything
   *  that file contributed. */
  const BROKEN = {
    [GITLAB_CI_FILE]: ["include: /ci/absent.yml", "", "stages:", "  - build", ""].join("\n"),
  };

  test("a missing path makes the pipeline partial", () => {
    const parsed = parseTree(BROKEN);
    expect(isPartial(parsed.pipeline)).toBe(true);
    expect(parsed.pipeline.unresolved).toEqual([
      {
        form: "local",
        detail: "ci/absent.yml",
        from: GITLAB_CI_FILE,
        range: { start: 9, end: 23 },
      },
    ]);
  });

  test("the error is not repeated as info: a single diagnostic per broken include", () => {
    expect(codes(BROKEN)).toEqual([INCLUDE_NOT_FOUND]);
  });

  test("all three failure forms count", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - /ci/absent.yml",
        "  - /ci/jobs.txt",
        "  - /../outside.yml",
        "  - 42",
        "",
      ].join("\n"),
    });

    expect(parsed.pipeline.unresolved).toHaveLength(4);
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([
      INCLUDE_NOT_FOUND,
      INCLUDE_NOT_FOUND,
      INCLUDE_NOT_FOUND,
      INCLUDE_NOT_FOUND,
    ]);
  });

  test("an unreadable entry keeps its written value, and no adapter sentence", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - 42", ""].join("\n"),
    });
    expect(parsed.pipeline.unresolved.map((entry) => entry.detail)).toEqual(["42"]);
  });

  test("an include key with no value is named by its key, not by an empty detail", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: "include:\nbuild:\n  script: make\n" });
    expect(parsed.pipeline.unresolved.map((entry) => entry.detail)).toEqual(["include"]);
    expect(parsed.pipeline.unresolved[0]?.range).toEqual({ start: 0, end: 7 });
  });

  test("a null item of an include list is named by the key too", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: "include:\n  - ~\n" });
    expect(parsed.pipeline.unresolved.map((entry) => entry.detail)).toEqual(["~"]);
  });

  test("a resolved include does not count, even next to a broken one", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include:", "  - /ci/good.yml", "  - /ci/absent.yml", ""].join("\n"),
      "ci/good.yml": JOB("a", "build"),
    });
    expect(parsed.pipeline.unresolved.map((entry) => entry.detail)).toEqual(["ci/absent.yml"]);
    expect(parsed.pipeline.jobs.map((entry) => entry.id)).toEqual(["a"]);
  });

  /** The cycle stops on a file **already read**: the pipeline did receive its content, so it does
   *  not become partial. Measuring this avoids turning `isPartial` into “there was a problem
   *  somewhere”. The limit, on the other hand, cuts content: see below. */
  test("a cycle does not make the pipeline partial: the content was read", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\n",
      "ci/a.yml": `include: .gitlab-ci.yml\n\n${JOB("a", "build")}`,
    });
    expect(parsed.diagnostics.map((entry) => entry.code)).toContain(INCLUDE_CYCLE);
    expect(isPartial(parsed.pipeline)).toBe(false);
    expect(parsed.pipeline.jobs.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("precedence between extends and cross-file definitions", () => {
  /** Found by the independent review of 2026-10-23. GitLab merges the includes then the main
   *  file, and only resolves `extends` afterwards, on the merged job: a job's own keys always beat
   *  its templates. Keelson did the opposite, because the main file's template sources arrived
   *  after the include's map — and the Pipeline view therefore put the job in the wrong
   *  column. */
  test("a value written in the include beats an extends written in the main file", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        ".base:",
        "  stage: test",
        "",
        "compile:",
        "  extends: .base",
        "",
      ].join("\n"),
      "ci/jobs.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });

    expect(parsed.pipeline.jobs[0]?.stage).toEqual({
      value: "build",
      origin: { kind: "include", file: "ci/jobs.yml" },
    });
  });

  test("an extends brings what the job declares nowhere", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        ".base:",
        "  environment:",
        "    name: production",
        "",
        "compile:",
        "  extends: .base",
        "",
      ].join("\n"),
      "ci/jobs.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });

    expect(parsed.pipeline.jobs[0]?.environment?.value.name).toBe("production");
    expect(parsed.pipeline.jobs[0]?.stage.value).toBe("build");
  });

  test("the extends of both files add up without duplicates", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "",
        ".from-main:",
        "  script:",
        "    - make",
        "",
        "compile:",
        "  extends:",
        "    - .from-main",
        "    - .from-include",
        "",
      ].join("\n"),
      "ci/jobs.yml": [
        ".from-include:",
        "  stage: build",
        "",
        "compile:",
        "  extends: .from-include",
        "",
      ].join("\n"),
    });

    expect(parsed.pipeline.jobs[0]?.extends).toEqual([".from-include", ".from-main"]);
  });
});

describe("root opaque blocks", () => {
  test("a key redefined as a job by a later file is a job, not also a root opaque block", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: ["include: ci/a.yml", "", JOB("compile", "build")].join("\n"),
      "ci/a.yml": "compile: placeholder\nvariables:\n  A: b\n",
    });
    expect(parsed.pipeline.jobs.map((job) => job.id)).toEqual(["compile"]);
    expect(parsed.pipeline.opaque.map((block) => block.key)).toEqual(["variables", "include"]);
  });

  test("a job replaced by a scalar in a later file stays a root opaque block", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/a.yml\ncompile: placeholder\n",
      "ci/a.yml": JOB("compile", "build"),
    });
    expect(parsed.pipeline.jobs).toEqual([]);
    expect(parsed.pipeline.opaque.map((block) => block.key)).toEqual(["include", "compile"]);
  });
});

describe("opaque blocks of an overridden job", () => {
  /** The defect the review found **on the milestone's own golden**: opaque blocks were taken from
   *  the owning definition alone, so a job defined in an include and overridden in the main file
   *  lost its `script` and `artifacts` on screen. The `override` golden froze `"opaque": []`.
   *
   *  Worse than the defect: the fix existed, and one of my file restorations during a red check
   *  destroyed it silently. Regenerating the goldens then blessed the regression. That is why
   *  this test reads the **keys and files**, not a count. */
  test("opaque blocks come from every definition, each with its file", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "  - test",
        "",
        "compile:",
        "  stage: test",
        "  rules:",
        "    - when: manual",
        "",
      ].join("\n"),
      "ci/jobs.yml": [
        "compile:",
        "  stage: build",
        "  script:",
        "    - make",
        "  artifacts:",
        "    paths:",
        "      - build/",
        "",
      ].join("\n"),
    });

    const compile = parsed.pipeline.jobs[0];
    expect(compile?.file).toBe(GITLAB_CI_FILE);
    expect(compile?.opaque.map((block) => [block.key, block.file])).toEqual([
      ["script", "ci/jobs.yml"],
      ["artifacts", "ci/jobs.yml"],
      ["rules", GITLAB_CI_FILE],
    ]);
  });

  test("a redefined key keeps only the last one, with the winning file", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include: ci/jobs.yml",
        "",
        "stages:",
        "  - build",
        "",
        "compile:",
        "  script:",
        "    - make other",
        "",
      ].join("\n"),
      "ci/jobs.yml": "compile:\n  stage: build\n  script:\n    - make\n",
    });

    expect(parsed.pipeline.jobs[0]?.opaque.map((block) => [block.key, block.file])).toEqual([
      ["script", GITLAB_CI_FILE],
    ]);
  });
});

describe("a !reference crosses files", () => {
  /** Required by milestone L2b and announced in its scoping, then never delivered: the reference
   *  was looked up in the single file carrying it, and a comment presented that limitation as a
   *  GitLab rule. Result: `stage` fell back to the default, without a diagnostic. */
  const TREE = {
    [GITLAB_CI_FILE]: [
      "include: /ci/base.yml",
      "",
      "stages:",
      "  - build",
      "  - deploy",
      "",
      "compile:",
      "  stage: build",
      "  script:",
      "    - make",
      "",
      "deliver:",
      "  stage: !reference [.base, stage]",
      "  needs: !reference [.base, needs]",
      "  environment: !reference [.base, environment]",
      "  script:",
      "    - make ship",
      "",
    ].join("\n"),
    "ci/base.yml": [
      ".base:",
      "  stage: deploy",
      "  needs:",
      "    - compile",
      "  environment:",
      "    name: production",
      "",
    ].join("\n"),
  };

  function deliver() {
    return parseTree(TREE).pipeline.jobs.find((job) => job.id === "deliver");
  }

  test("the referenced stage is the included file's", () => {
    expect(deliver()?.stage).toEqual({
      value: "deploy",
      origin: { kind: "reference", path: [".base", "stage"] },
    });
  });

  test("the referenced needs and environment too", () => {
    expect(deliver()?.needs?.value.map((need) => need.job)).toEqual(["compile"]);
    expect(deliver()?.environment?.value.name).toBe("production");
  });

  test("the main file wins when both define the target", () => {
    const parsed = parseTree({
      ...TREE,
      [GITLAB_CI_FILE]: `${TREE[GITLAB_CI_FILE]}\n.base:\n  stage: build\n`,
    });
    expect(parsed.pipeline.jobs.find((job) => job.id === "deliver")?.stage.value).toBe("build");
  });
});

describe("the target of a !reference follows the merged configuration", () => {
  const ref = "deploy:\n  stage: !reference [.b, stage]\n  script:\n    - make\n";

  function stageOf(main: string, included: string): string | undefined {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: `include: ci/x.yml\n\n${main}\n${ref}`,
      "ci/x.yml": included,
    });
    return parsed.pipeline.jobs.find((job) => job.id === "deploy")?.stage.value;
  }

  /** `getIn` traverses neither aliases nor merge keys: it returned “absent”, and the lookup fell
   *  back to an earlier file, hence to the losing value. */
  test("the winning file goes through an alias", () => {
    expect(stageOf(".a: &a\n  stage: b\n.b: *a", ".b:\n  stage: c\n")).toBe("b");
  });

  test("the winning file goes through a merge key", () => {
    expect(stageOf(".a: &a\n  stage: b\n.b:\n  <<: *a", ".b:\n  stage: c\n")).toBe("b");
  });

  test("the targeted value is itself an alias", () => {
    expect(stageOf("x: &v b\n.b:\n  stage: *v", "")).toBe("b");
  });

  /** A value that is not a map replaces the include's: there is nothing left to find. */
  test("a key replaced by a scalar does not let the include through", () => {
    expect(stageOf(".b: 1", ".b:\n  stage: c\n")).toBe("test");
  });

  /** The last occurrence of a file included twice wins, for `extends` as for `!reference`: the
   *  two must not contradict each other in the same pipeline. */
  test("a file included twice wins at its last occurrence", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        "  - ci/x.yml",
        "  - ci/y.yml",
        "  - ci/x.yml",
        "",
        "via-extends:",
        "  extends: .t",
        "  script:",
        "    - make",
        "",
        "via-reference:",
        "  stage: !reference [.t, stage]",
        "  script:",
        "    - make",
        "",
      ].join("\n"),
      "ci/x.yml": ".t:\n  stage: a\n",
      "ci/y.yml": ".t:\n  stage: b\n",
    });
    const stages = parsed.pipeline.jobs.map((job) => job.stage.value);
    expect(stages).toEqual(["a", "a"]);
  });
});

describe("remote include in short form", () => {
  /** “If the file is a remote file, it is the same as include:remote”: a bare URL is not a local
   *  path. Treating it as one rewrote the URL, returned a false missing-file error, and turned a
   *  missing `extends` target into an error. */
  const URL = "https://example.com/ci/base.yml";

  test("a bare URL is a remote include, intact", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: `include: '${URL}'\n` });
    expect(parsed.pipeline.unresolved.map((entry) => [entry.form, entry.detail])).toEqual([
      ["remote", URL],
    ]);
    expect(codes({ [GITLAB_CI_FILE]: `include: '${URL}'\n` })).toEqual([INCLUDE_UNRESOLVED]);
  });

  test("in a list too, and the missing extends target stays a warning", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: [
        "include:",
        `  - ${URL}`,
        "",
        "orphan:",
        "  extends: .absent",
        "  script:",
        "    - make",
        "",
      ].join("\n"),
    });
    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("warning");
  });

  test("a local path containing http is not a URL", () => {
    const parsed = parseTree({
      [GITLAB_CI_FILE]: "include: ci/https.yml\n",
      "ci/https.yml": JOB("a", "build"),
    });
    expect(parsed.pipeline.unresolved).toEqual([]);
  });
});

describe("include limit and partial pipeline", () => {
  /** What the limit cuts was not read: the pipeline is therefore partial, and a missing `extends`
   *  target may be in it. The first version left `isPartial` false. */
  function beyond(extra: string) {
    const files: Record<string, string> = { [GITLAB_CI_FILE]: `include: ci/f0.yml\n${extra}` };
    const total = MAX_INCLUDED_FILES + 5;
    for (let index = 0; index < total; index += 1) {
      files[`ci/f${index}.yml`] = index + 1 < total ? `include: ci/f${index + 1}.yml\n` : "";
    }
    return parseTree(files);
  }

  test("the pipeline cut by the limit is partial", () => {
    expect(isPartial(beyond("").pipeline)).toBe(true);
  });

  test("a missing extends target stays a warning there", () => {
    const parsed = beyond("\norphan:\n  extends: .absent\n  script:\n    - make\n");
    expect(
      parsed.diagnostics.find((entry) => entry.code === EXTENDS_TARGET_NOT_FOUND)?.severity,
    ).toBe("warning");
  });
});

describe("variables in a local include", () => {
  /** “You can use certain CI/CD variables” in `include:local`
   *  <https://docs.gitlab.com/ci/yaml/#includelocal>: the path is only known at run time. */
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitLab variable, written as in the file
  test.each([["ci/$ENV.yml"], ["ci/${ENV}.yml"], ["$CI_PROJECT_DIR/ci/jobs.yml"]])(
    "%s is unresolved, not missing",
    (path) => {
      const parsed = parseTree({
        [GITLAB_CI_FILE]: `include:\n  - local: '${path}'\n`,
      });
      expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([INCLUDE_UNRESOLVED]);
      expect(parsed.pipeline.unresolved).toEqual([
        { form: "local", detail: path, from: GITLAB_CI_FILE, range: expect.any(Object) },
      ]);
      expect(isPartial(parsed.pipeline)).toBe(true);
    },
  );

  test("a dollar that names no variable is still a path", () => {
    const parsed = parseTree({ [GITLAB_CI_FILE]: "include: ci/a$.yml\n" });
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([INCLUDE_NOT_FOUND]);
  });
});

describe("a reader that refuses a path", () => {
  test("a path the reader refuses as outside the root is reported as such", () => {
    const files: Record<string, string> = { [GITLAB_CI_FILE]: "include: ci/leak.yml\n" };
    const read: IncludeReader = {
      read: (path) => files[path] ?? null,
      candidates: () => Object.keys(files),
      outsideRoot: (path) => path === "ci/leak.yml",
    };
    const parsed = parse(files[GITLAB_CI_FILE] ?? "", { file: GITLAB_CI_FILE, read });
    expect(parsed.diagnostics.find((entry) => entry.code === INCLUDE_NOT_FOUND)?.params).toEqual({
      reason: "outsideRoot",
      path: "ci/leak.yml",
    });
  });
});
