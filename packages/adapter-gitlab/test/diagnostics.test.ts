import { describe, expect, test } from "bun:test";
import {
  EXTENDS_CYCLE,
  EXTENDS_TARGET_NOT_FOUND,
  INCLUDE_UNRESOLVED,
  INVALID_YAML,
  JOB_WITHOUT_SCRIPT,
} from "@keelson/core";
import { renderMessage } from "@keelson/core/messages";
import { parse } from "../src/parse.ts";
import { readEdgeCase } from "./support/corpus.ts";

function diagnostic(text: string, code: string) {
  return parse(text).diagnostics.find((candidate) => candidate.code === code);
}

function codes(text: string): string[] {
  return parse(text).diagnostics.map((candidate) => candidate.code);
}

describe("INVALID_YAML", () => {
  test("reports a syntax error", () => {
    const found = diagnostic("a:\n  - x\n bad: [1,\n", INVALID_YAML);
    expect(found?.severity).toBe("error");
  });

  test("carries a position in the text", () => {
    const text = "a:\n  - x\n bad: [1,\n";
    const found = diagnostic(text, INVALID_YAML);
    expect(found?.range).not.toBeNull();
    if (found?.range != null) {
      expect(found.range.start).toBeGreaterThanOrEqual(0);
      expect(found.range.end).toBeLessThanOrEqual(text.length);
    }
  });

  test("valid YAML triggers nothing", () => {
    expect(codes("a:\n  script: x\n")).not.toContain(INVALID_YAML);
  });

  test("parsing never throws on broken YAML", () => {
    expect(() => parse("{{{\n:::\n- - -\n")).not.toThrow();
    expect(() => parse("\t\tindentation par tabulation\n")).not.toThrow();
  });
});

describe("INCLUDE_UNRESOLVED", () => {
  test("reports the presence of include as info", () => {
    const found = diagnostic(readEdgeCase("with-include"), INCLUDE_UNRESOLVED);
    expect(found?.severity).toBe("info");
  });

  /** The range points at the **entry**, not at the `include` key: a file can mix resolved and
   *  unresolved includes, and underlining the shared key would say the whole block is at fault.
   *  No `if (range != null)` here — that was a guard that let the test pass precisely in the
   *  case where it had measured nothing. */
  test("carries the range of the unresolved entry, not that of the include key", () => {
    const text = readEdgeCase("with-include");
    const found = diagnostic(text, INCLUDE_UNRESOLVED);
    const range = found?.range;
    if (range === null || range === undefined) {
      throw new Error("INCLUDE_UNRESOLVED without a range");
    }
    // `trimEnd`: a `yaml` node's range runs up to the start of the next node, so it takes the
    // line break with it. That is the convention of `contentRange` throughout the adapter.
    expect(text.slice(range.start, range.end).trimEnd()).toBe("template: Jobs/SAST.gitlab-ci.yml");
  });

  test("one diagnostic per unresolved entry, and none for a local include", () => {
    const found = parse(readEdgeCase("with-include")).diagnostics.filter(
      (candidate) => candidate.code === INCLUDE_UNRESOLVED,
    );
    // Three entries, including a `local:` — without a reader it also counts as unresolved, but
    // with its own form, so as not to claim that a repository file is out of reach.
    expect(found.map((candidate) => candidate.params.form)).toEqual([
      "template",
      "local",
      "project",
    ]);
  });

  test("a file without include triggers nothing", () => {
    expect(codes(readEdgeCase("flow-needs"))).not.toContain(INCLUDE_UNRESOLVED);
  });
});

describe("EXTENDS_TARGET_NOT_FOUND", () => {
  test("error when the file has no include", () => {
    expect(diagnostic(readEdgeCase("extends-missing"), EXTENDS_TARGET_NOT_FOUND)?.severity).toBe(
      "error",
    );
  });

  test("warning when the file has includes", () => {
    expect(diagnostic(readEdgeCase("with-include"), EXTENDS_TARGET_NOT_FOUND)?.severity).toBe(
      "warning",
    );
  });

  test("names the missing target", () => {
    const found = diagnostic(readEdgeCase("extends-missing"), EXTENDS_TARGET_NOT_FOUND);
    expect(found?.params).toEqual({ template: ".absent" });
    expect(found === undefined ? "" : renderMessage(found)).toContain(".absent");
  });

  test("is not reported twice for the same target", () => {
    const text = [
      "stages:",
      "  - test",
      "",
      "un:",
      "  extends: .absent",
      "  script: a",
      "",
      "deux:",
      "  extends: .absent",
      "  script: b",
      "",
    ].join("\n");
    expect(codes(text).filter((code) => code === EXTENDS_TARGET_NOT_FOUND)).toHaveLength(1);
  });
});

describe("EXTENDS_CYCLE", () => {
  test("reports a cycle as an error", () => {
    expect(diagnostic(readEdgeCase("extends-cycle"), EXTENDS_CYCLE)?.severity).toBe("error");
  });

  test("an extends to itself is a cycle", () => {
    const text = "stages:\n  - test\n\nmoi:\n  extends: moi\n  script: x\n";
    expect(codes(text)).toContain(EXTENDS_CYCLE);
  });

  test("a sound chain triggers nothing", () => {
    expect(codes(readEdgeCase("extends-chain"))).not.toContain(EXTENDS_CYCLE);
  });
});

describe("JOB_WITHOUT_SCRIPT", () => {
  const text = readEdgeCase("sans-script");

  test("reports a job without script as a warning", () => {
    const found = diagnostic(text, JOB_WITHOUT_SCRIPT);
    expect(found?.severity).toBe("warning");
    expect(found?.params).toEqual({ job: "muet" });
  });

  test("a job with trigger is not reported", () => {
    const jobs = parse(text)
      .diagnostics.filter((candidate) => candidate.code === JOB_WITHOUT_SCRIPT)
      .map((candidate) => renderMessage(candidate));
    expect(jobs.some((message) => message.includes("declencheur"))).toBe(false);
  });

  test("a job with run is not reported", () => {
    const jobs = parse(text)
      .diagnostics.filter((candidate) => candidate.code === JOB_WITHOUT_SCRIPT)
      .map((candidate) => renderMessage(candidate));
    expect(jobs.some((message) => message.includes("avec-run"))).toBe(false);
  });

  test("is evaluated after extends resolution", () => {
    const inherited = [
      ".avec-script:",
      "  script:",
      "    - echo herite",
      "",
      "stages:",
      "  - test",
      "",
      "herite:",
      "  extends: .avec-script",
      "  stage: test",
      "",
    ].join("\n");
    expect(codes(inherited)).not.toContain(JOB_WITHOUT_SCRIPT);
  });

  test("is evaluated after anchor resolution", () => {
    const anchored = [
      ".base: &base",
      "  script:",
      "    - echo anchor",
      "",
      "boulot:",
      "  <<: *base",
      "",
    ].join("\n");
    expect(codes(anchored)).not.toContain(JOB_WITHOUT_SCRIPT);
  });
});

describe("deduplication by code and params", () => {
  /** Deduplication used to rely on the `message`, which no longer exists. Had it settled for the
   *  `code`, two **different** missing `extends` targets would have merged into a single
   *  diagnostic, and one of them would have become invisible. */
  test("two different missing extends targets yield two diagnostics", () => {
    const text = [
      "stages:",
      "  - test",
      "",
      "un:",
      "  extends: .absent-un",
      "  script: a",
      "",
      "deux:",
      "  extends: .absent-deux",
      "  script: b",
      "",
    ].join("\n");

    const found = parse(text).diagnostics.filter(
      (candidate) => candidate.code === EXTENDS_TARGET_NOT_FOUND,
    );
    expect(found.map((candidate) => candidate.params)).toEqual([
      { template: ".absent-un" },
      { template: ".absent-deux" },
    ]);
  });
});

describe("shape of diagnostics", () => {
  test("no diagnostic carries a message or details", () => {
    const text = [
      "include:",
      "  - template: Jobs/SAST.gitlab-ci.yml",
      "",
      "stages:",
      "  - test",
      "",
      "muet:",
      "  stage: test",
      "",
      "orphelin:",
      "  extends: .absent",
      "  script: a",
      "",
    ].join("\n");

    const found = parse(text).diagnostics;
    expect(found.length).toBeGreaterThan(0);
    for (const candidate of found) {
      expect(Object.keys(candidate).sort()).toEqual([
        "code",
        "file",
        "params",
        "range",
        "severity",
      ]);
    }
  });
});

describe("official corpus", () => {
  test("no official template produces a YAML error", () => {
    expect(codes(readEdgeCase("comments"))).not.toContain(INVALID_YAML);
  });
});
