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

  test("a huge file with two distant changes marks only those, and stays fast", () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `l${index}`);
    const changed = [
      ...lines.slice(0, 10),
      "stage",
      ...lines.slice(10, 4990),
      "job",
      ...lines.slice(4991),
    ];
    const started = performance.now();
    const rows = diffRows(lines.join("\n"), changed.join("\n"));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(rows.filter((row) => row.kind !== "same")).toEqual([
      { kind: "add", text: "stage" },
      { kind: "remove", text: "l4990" },
      { kind: "add", text: "job" },
    ]);
  });

  test("property: on large texts too, each side is rebuilt and a few edits stay a few rows", () => {
    const lines = fc.array(fc.constantFrom("a", "b", "c", "d", ""), {
      minLength: 2100,
      maxLength: 2300,
    });
    const edit = fc.record({ at: fc.nat(), remove: fc.nat(3), insert: fc.array(fc.string()) });
    const edited = fc.tuple(lines, fc.array(edit, { maxLength: 40 })).map(([base, edits]) => {
      const changed: string[] = [...base];
      let budget = 0;
      for (const { at, remove, insert } of edits) {
        const removed = changed.splice(at % (changed.length + 1), remove, ...insert);
        budget += removed.length + insert.length;
      }
      return { before: base.join("\n"), after: changed.join("\n"), budget };
    });
    const unrelated = fc
      .tuple(lines, lines)
      .map(([a, b]) => ({ before: a.join("\n"), after: b.join("\n"), budget: Infinity }));
    fc.assert(
      fc.property(fc.oneof(edited, unrelated), ({ before, after, budget }) => {
        const rows = diffRows(before, after);
        const linesOf = (value: string) => {
          const split = value.split("\n");
          return split.at(-1) === "" ? split.slice(0, -1) : split;
        };
        expect(side(rows, "remove")).toEqual(linesOf(before));
        expect(side(rows, "add")).toEqual(linesOf(after));
        expect(rows.filter((row) => row.kind !== "same").length).toBeLessThanOrEqual(budget);
      }),
      { numRuns: Math.min(runs, 50) },
    );
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
