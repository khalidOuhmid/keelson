import { afterEach, describe, expect, test } from "bun:test";
import type { Diagnostic, Severity, SourceRange } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosticsPanel } from "../../src/panels/DiagnosticsPanel.tsx";

afterEach(cleanup);

/** Un diagnostic ne porte plus de `message` : le code et ses `params` vont ensemble, et le
 *  compilateur le vérifie. Les fixtures nomment donc un code réel, jamais un code inventé. */
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
  test("le panneau est une région nommée", () => {
    renderPanel([]);
    expect(screen.getByRole("region", { name: /diagnostics/i })).toBeDefined();
  });

  test("aucun diagnostic affiche un état vide explicite", () => {
    renderPanel([]);
    expect(screen.getByText(/no diagnostics/i)).toBeDefined();
  });

  test("un élément de liste par diagnostic", () => {
    renderPanel([diagnostic(), diagnostic("cycle")]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("le compte des diagnostics est annoncé", () => {
    renderPanel([diagnostic(), diagnostic("cycle")]);
    expect(screen.getByRole("region", { name: /diagnostics/i }).textContent).toContain("2");
  });
});

describe("contenu d'un diagnostic", () => {
  test("le code et le message sont affichés", () => {
    renderPanel([diagnostic()]);
    expect(screen.getByText("UNKNOWN_NEED")).toBeDefined();
    expect(screen.getByText('job "unit" needs "absent", which does not exist')).toBeDefined();
  });

  test("la sévérité est affichée en texte, pas seulement par la couleur", () => {
    renderPanel([
      diagnostic("need", { severity: "error" }),
      diagnostic("later", { severity: "warning" }),
      diagnostic("include", { severity: "info" }),
    ]);
    expect(screen.getByText("error")).toBeDefined();
    expect(screen.getByText("warning")).toBeDefined();
    expect(screen.getByText("info")).toBeDefined();
  });

  test("chaque sévérité porte un glyphe distinct", () => {
    renderPanel([
      diagnostic("need", { severity: "error" }),
      diagnostic("later", { severity: "warning" }),
      diagnostic("include", { severity: "info" }),
    ]);
    // Les marques sont des SVG : c'est leur tracé qui les distingue, plus leur texte.
    const glyphs = screen.getAllByTestId("severity-glyph").map((node) => node.innerHTML);
    expect(new Set(glyphs).size).toBe(3);
    expect(glyphs.every((glyph) => glyph.includes("<svg"))).toBe(true);
  });

  test("les diagnostics sont triés par sévérité, erreurs d'abord", () => {
    renderPanel([
      diagnostic("include", { severity: "info" }),
      diagnostic("need", { severity: "error" }),
      diagnostic("later", { severity: "warning" }),
    ]);
    const codes = screen.getAllByTestId("diagnostic-code").map((node) => node.textContent);
    expect(codes).toEqual(["UNKNOWN_NEED", "NEED_LATER_STAGE", "INCLUDE_UNRESOLVED"]);
  });
});

describe("sélection", () => {
  test("un clic sur un diagnostic remonte sa plage", async () => {
    const picked: { file: string; range: Picked }[] = [];
    renderPanel([diagnostic()], (file, range) => picked.push({ file, range }));
    await userEvent.click(screen.getByRole("button", { name: /UNKNOWN_NEED/ }));
    expect(picked).toEqual([{ file: MAIN, range: { start: 40, end: 90 } }]);
  });

  test("Entrée au clavier remonte aussi la plage", async () => {
    const picked: { file: string; range: Picked }[] = [];
    renderPanel([diagnostic()], (file, range) => picked.push({ file, range }));
    screen.getByRole("button", { name: /UNKNOWN_NEED/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(picked).toEqual([{ file: MAIN, range: { start: 40, end: 90 } }]);
  });

  test("un diagnostic sans plage n'est pas cliquable", () => {
    renderPanel([diagnostic("need", { range: null })]);
    expect(screen.queryByRole("button", { name: /UNKNOWN_NEED/ })).toBeNull();
  });

  test("un diagnostic sans plage reste affiché", () => {
    renderPanel([diagnostic("need", { range: null })]);
    expect(screen.getByText("UNKNOWN_NEED")).toBeDefined();
  });

  test("chaque diagnostic cliquable est atteignable au clavier", () => {
    renderPanel([diagnostic(), diagnostic("cycle")]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("tabindex")).not.toBe("-1");
    }
  });
});
