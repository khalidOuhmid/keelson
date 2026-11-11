import { afterEach, describe, expect, test } from "bun:test";
import type { Diagnostic, Severity, SourceRange } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosticsPanel } from "../../src/panels/DiagnosticsPanel.tsx";

afterEach(cleanup);

/** A diagnostic no longer carries a `message`: the code and its `params` go together, and the
 *  compiler checks it. Fixtures therefore name a real code, never an invented one. */
const MAIN = ".gitlab-ci.yml";

const SAMPLES = {
  need: { code: "UNKNOWN_NEED", params: { job: "unit", need: "absent" } },
  cycle: { code: "NEEDS_CYCLE", params: { cycle: ["a", "b", "a"] } },
  later: {
    code: "NEED_LATER_STAGE",
    params: { job: "compile", stage: "build", need: "publish", needStage: "deploy" },
  },
  include: {
    code: "INCLUDE_UNRESOLVED",
    params: { form: "template", detail: "Jobs/SAST.gitlab-ci.yml" },
  },
} as const satisfies Record<string, Pick<Diagnostic, "code" | "params">>;

type Shape = { severity?: Severity; range?: SourceRange | null };

function diagnostic(sample: keyof typeof SAMPLES = "need", shape: Shape = {}): Diagnostic {
  return {
    file: MAIN,
    ...SAMPLES[sample],
    severity: shape.severity ?? "error",
    range: shape.range === undefined ? { start: 40, end: 90 } : shape.range,
  } as Diagnostic;
}

type Picked = { start: number; end: number } | null;

function renderPanel(
  diagnostics: Diagnostic[],
  onSelect: (file: string, range: Picked) => void = () => {},
  main = MAIN,
) {
  return render(
    <DiagnosticsPanel diagnostics={diagnostics} onSelectRange={onSelect} main={main} />,
  );
}

describe("structure", () => {
  test("the panel is a named region", () => {
    renderPanel([]);
    expect(screen.getByRole("region", { name: /diagnostics/i })).toBeDefined();
  });

  test("no diagnostics shows an explicit empty state", () => {
    renderPanel([]);
    expect(screen.getByText(/no diagnostics/i)).toBeDefined();
  });

  test("one list item per diagnostic", () => {
    renderPanel([diagnostic(), diagnostic("cycle")]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("the diagnostic count is announced", () => {
    renderPanel([diagnostic(), diagnostic("cycle")]);
    expect(screen.getByRole("region", { name: /diagnostics/i }).textContent).toContain("2");
  });
});

describe("diagnostic content", () => {
  test("the code and the message are shown", () => {
    renderPanel([diagnostic()]);
    expect(screen.getByText("UNKNOWN_NEED")).toBeDefined();
    expect(screen.getByText('job "unit" needs "absent", which does not exist')).toBeDefined();
  });

  test("severity is shown as text, not only by colour", () => {
    renderPanel([
      diagnostic("need", { severity: "error" }),
      diagnostic("later", { severity: "warning" }),
      diagnostic("include", { severity: "info" }),
    ]);
    expect(screen.getByText("error")).toBeDefined();
    expect(screen.getByText("warning")).toBeDefined();
    expect(screen.getByText("info")).toBeDefined();
  });

  test("each severity has a distinct glyph", () => {
    renderPanel([
      diagnostic("need", { severity: "error" }),
      diagnostic("later", { severity: "warning" }),
      diagnostic("include", { severity: "info" }),
    ]);
    // The marks are SVGs: their path is what tells them apart, no longer their text.
    const glyphs = screen.getAllByTestId("severity-glyph").map((node) => node.innerHTML);
    expect(new Set(glyphs).size).toBe(3);
    expect(glyphs.every((glyph) => glyph.includes("<svg"))).toBe(true);
  });

  test("diagnostics are sorted by severity, errors first", () => {
    renderPanel([
      diagnostic("include", { severity: "info" }),
      diagnostic("need", { severity: "error" }),
      diagnostic("later", { severity: "warning" }),
    ]);
    const codes = screen.getAllByTestId("diagnostic-code").map((node) => node.textContent);
    expect(codes).toEqual(["UNKNOWN_NEED", "NEED_LATER_STAGE", "INCLUDE_UNRESOLVED"]);
  });
});

describe("selection", () => {
  test("clicking a diagnostic reports its range", async () => {
    const picked: { file: string; range: Picked }[] = [];
    renderPanel([diagnostic()], (file, range) => picked.push({ file, range }));
    await userEvent.click(screen.getByRole("button", { name: /UNKNOWN_NEED/ }));
    expect(picked).toEqual([{ file: MAIN, range: { start: 40, end: 90 } }]);
  });

  test("Enter on the keyboard also reports the range", async () => {
    const picked: { file: string; range: Picked }[] = [];
    renderPanel([diagnostic()], (file, range) => picked.push({ file, range }));
    screen.getByRole("button", { name: /UNKNOWN_NEED/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(picked).toEqual([{ file: MAIN, range: { start: 40, end: 90 } }]);
  });

  test("a diagnostic without a range is not clickable", () => {
    renderPanel([diagnostic("need", { range: null })]);
    expect(screen.queryByRole("button", { name: /UNKNOWN_NEED/ })).toBeNull();
  });

  test("a diagnostic without a range stays visible", () => {
    renderPanel([diagnostic("need", { range: null })]);
    expect(screen.getByText("UNKNOWN_NEED")).toBeDefined();
  });

  test("every clickable diagnostic is reachable from the keyboard", () => {
    renderPanel([diagnostic(), diagnostic("cycle")]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("tabindex")).not.toBe("-1");
    }
  });
});
