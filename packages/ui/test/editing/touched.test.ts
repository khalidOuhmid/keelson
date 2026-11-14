import { describe, expect, test } from "bun:test";
import { describeTouched } from "../../src/editing/touched.ts";

const TEXT = "stages:\n  - build\n  - test\nlint:\n  script: make\n";

describe("naming the lines a write touched", () => {
  test("one line", () => {
    expect(describeTouched(".gitlab-ci.yml", TEXT, [{ start: 10, end: 17 }])).toBe(
      "Changed line 2 of .gitlab-ci.yml.",
    );
  });

  test("a range across lines, ending on a newline, does not count the next line", () => {
    expect(describeTouched("ci.yml", TEXT, [{ start: 8, end: 27 }])).toBe(
      "Changed lines 2–3 of ci.yml.",
    );
  });

  test("several ranges, in file order, merged when they meet", () => {
    expect(
      describeTouched("ci.yml", TEXT, [
        { start: 28, end: 33 },
        { start: 0, end: 3 },
        { start: 10, end: 12 },
      ]),
    ).toBe("Changed lines 1–2 and 4 of ci.yml.");
  });

  test("three separate places read as a list", () => {
    expect(
      describeTouched("ci.yml", TEXT, [
        { start: 0, end: 1 },
        { start: 19, end: 20 },
        { start: 34, end: 35 },
      ]),
    ).toBe("Changed lines 1, 3 and 5 of ci.yml.");
  });

  test("an empty range is the place where text was removed", () => {
    expect(describeTouched("ci.yml", TEXT, [{ start: 18, end: 18 }])).toBe(
      "Changed line 3 of ci.yml.",
    );
  });

  test("nothing touched, nothing to say", () => {
    expect(describeTouched("ci.yml", TEXT, [])).toBeNull();
  });
});
