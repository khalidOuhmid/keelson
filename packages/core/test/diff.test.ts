import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { type DiffRow, diffRows, visibleRows } from "../src/index.ts";

const runs = Number(process.env.KEELSON_FC_RUNS ?? 25);

function side(rows: readonly DiffRow[], kept: DiffRow["kind"]): string[] {
  return rows.filter((row) => row.kind === "same" || row.kind === kept).map((row) => row.text);
}

describe("diffRows", () => {
  test("common lines stay, the others are marked", () => {
    expect(diffRows("a\nb\nc\n", "a\nx\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  test("a trailing newline is not a line, and CRLF splits like LF", () => {
    expect(diffRows("a\r\nb\r\n", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  test("an insertion between two lines is a single added row", () => {
    expect(diffRows("a\nc\n", "a\nb\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  test("a huge file does not block: the whole middle changes", () => {
    const left = Array.from({ length: 5000 }, (_, index) => `a${index}`).join("\n");
    const right = Array.from({ length: 5000 }, (_, index) => `b${index}`).join("\n");
    const started = performance.now();
    expect(diffRows(left, right).length).toBe(10000);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("a huge file with a small change keeps its common prefix and suffix", () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `l${index}`);
    const changed = [...lines.slice(0, 2500), "new", ...lines.slice(2500)];
    const rows = diffRows(lines.join("\n"), changed.join("\n"));
    expect(rows.filter((row) => row.kind !== "same")).toEqual([{ kind: "add", text: "new" }]);
  });

  test("property: each side is rebuilt from its rows, in order", () => {
    const text = fc
      .array(fc.constantFrom("a", "b", "c", "d", ""), { maxLength: 30 })
      .map((lines) => lines.join("\n"));
    fc.assert(
      fc.property(text, text, (before, after) => {
        const rows = diffRows(before, after);
        const lines = (value: string) => {
          const split = value.split("\n");
          return split.at(-1) === "" ? split.slice(0, -1) : split;
        };
        expect(side(rows, "remove")).toEqual(lines(before));
        expect(side(rows, "add")).toEqual(lines(after));
      }),
      { numRuns: runs },
    );
  });

  test("property: an identical text has no change", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(diffRows(value, value).every((row) => row.kind === "same")).toBe(true);
      }),
      { numRuns: runs },
    );
  });
});

describe("visibleRows", () => {
  test("two distant regions stay two regions, the rest becomes gaps", () => {
    const middle = Array.from({ length: 20 }, (_, index) => `l${index}`).join("\n");
    const rows = diffRows(`a\n${middle}\nz\n`, `A\n${middle}\nZ\n`);
    expect(rows.filter((row) => row.kind !== "same")).toHaveLength(4);
    const visible = visibleRows(rows, 2);
    expect(visible.filter((row) => row.kind === "gap")).toHaveLength(1);
    expect(visible.filter((row) => row.kind === "same")).toHaveLength(4);
  });

  test("a gap opens the list when the first change is far from the top", () => {
    const rows = diffRows("1\n2\n3\n4\n5\n", "1\n2\n3\n4\nX\n");
    expect(visibleRows(rows, 1)).toEqual([
      { kind: "gap", text: "" },
      { kind: "same", text: "4" },
      { kind: "remove", text: "5" },
      { kind: "add", text: "X" },
    ]);
  });
});
