import { describe, expect, test } from "bun:test";
import { parseCommandArgs } from "../src/args.ts";

const formatSpec = {
  options: { format: { type: "string" } },
  allowPositionals: true,
} as const;

const flagSpec = {
  options: { "no-open": { type: "boolean" }, port: { type: "string" } },
  allowPositionals: true,
} as const;

describe("options with a value", () => {
  test("reads an option and its value", () => {
    const result = parseCommandArgs(["--format", "json"], formatSpec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.format).toBe("json");
      expect(result.positionals).toEqual([]);
    }
  });

  test("accepts the --option=value form", () => {
    const result = parseCommandArgs(["--format=json"], formatSpec);
    expect(result.ok && result.values.format).toBe("json");
  });

  test("refuses a value option without a value", () => {
    const result = parseCommandArgs(["--format"], formatSpec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("--format");
    }
  });

  test("leaves an absent option undefined", () => {
    const result = parseCommandArgs([], formatSpec);
    expect(result.ok && result.values.format).toBeUndefined();
  });
});

describe("positionals", () => {
  test("collects positionals in order", () => {
    const result = parseCommandArgs(["one", "two"], formatSpec);
    expect(result.ok && result.positionals).toEqual(["one", "two"]);
  });

  test("separates positionals and options", () => {
    const result = parseCommandArgs(["file.yml", "--format", "json"], formatSpec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.positionals).toEqual(["file.yml"]);
      expect(result.values.format).toBe("json");
    }
  });

  test("refuses a positional when they are not allowed", () => {
    const result = parseCommandArgs(["extra"], {
      options: {},
      allowPositionals: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe("boolean options", () => {
  test("a present boolean option is true", () => {
    const result = parseCommandArgs(["--no-open"], flagSpec);
    expect(result.ok && result.values["no-open"]).toBe(true);
  });

  test("an absent boolean option is undefined", () => {
    const result = parseCommandArgs([], flagSpec);
    expect(result.ok && result.values["no-open"]).toBeUndefined();
  });
});

describe("unknown options", () => {
  test("refuses an unknown option, naming it", () => {
    const result = parseCommandArgs(["--strict"], formatSpec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("--strict");
    }
  });

  test("refuses an unknown short option", () => {
    const result = parseCommandArgs(["-x"], formatSpec);
    expect(result.ok).toBe(false);
  });
});

describe("robustness", () => {
  test("never throws, even on absurd input", () => {
    for (const argv of [["--"], ["---"], ["--format", "--format"], ["-"], [""]]) {
      expect(() => parseCommandArgs(argv, formatSpec)).not.toThrow();
    }
  });

  test("the error message is always a non-empty string", () => {
    const result = parseCommandArgs(["--unknown"], formatSpec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
