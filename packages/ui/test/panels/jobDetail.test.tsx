import { afterEach, describe, expect, test } from "bun:test";
import type { Job, OpaqueBlock, Origin } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import { JobDetailPanel } from "../../src/panels/JobDetailPanel.tsx";
import { sliceOpaque } from "../../src/panels/opaque.ts";

afterEach(cleanup);

const TEXT = [
  "compile:",
  "  stage: build",
  "  script:",
  "    - make all",
  "    - make check",
  "  artifacts:",
  "    paths:",
  "      - build/",
  "",
].join("\n");

const MAIN = ".gitlab-ci.yml";

function at(needle: string, length: number): OpaqueBlock {
  const start = TEXT.indexOf(needle);
  return { key: needle.replace(":", ""), range: { start, end: start + length }, file: MAIN };
}

const SCRIPT_BLOCK = at("script:", "script:\n    - make all\n    - make check\n".length);
const ARTIFACTS_BLOCK = at("artifacts:", "artifacts:\n    paths:\n      - build/\n".length);

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "compile",
    stage: { value: "build", origin: { kind: "local" } },
    needs: null,
    environment: null,
    extends: [],
    opaque: [SCRIPT_BLOCK],
    range: { start: 0, end: TEXT.length },
    file: MAIN,
    ...overrides,
  };
}

function renderPanel(value: Job, text = TEXT) {
  return render(<JobDetailPanel job={value} text={text} onClose={() => undefined} />);
}

describe("sliceOpaque", () => {
  test("découpe le bloc dans le texte source", () => {
    expect(sliceOpaque(TEXT, SCRIPT_BLOCK)).toBe("script:\n    - make all\n    - make check");
  });

  test("retire le retour à la ligne final pour l'affichage", () => {
    expect(sliceOpaque(TEXT, ARTIFACTS_BLOCK)?.endsWith("\n")).toBe(false);
  });

  test("une plage hors bornes rend une chaîne vide plutôt que de lever", () => {
    expect(
      sliceOpaque(TEXT, { key: "x", range: { start: 9000, end: 9100 }, file: MAIN }),
    ).toBeNull();
  });

  test("une plage inversée rend une chaîne vide", () => {
    expect(sliceOpaque(TEXT, { key: "x", range: { start: 50, end: 10 }, file: MAIN })).toBeNull();
  });
});

describe("identité du job", () => {
  test("le panneau nomme le job", () => {
    renderPanel(job());
    expect(screen.getByRole("heading", { name: "compile" })).toBeDefined();
  });

  test("le panneau est une région nommée", () => {
    renderPanel(job());
    expect(screen.getByRole("region", { name: /job detail/i })).toBeDefined();
  });
});

describe("stage", () => {
  test("affiche le stage courant", () => {
    renderPanel(job());
    expect(screen.getByTestId("job-stage").textContent).toContain("build");
  });

  test("un stage hérité porte son badge d'origine", () => {
    renderPanel(job({ stage: { value: "build", origin: { kind: "extends", template: ".base" } } }));
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "inherited from .base",
    );
  });

  test("un stage local ne porte pas de badge", () => {
    renderPanel(job());
    expect(screen.queryByTestId("origin-badge")).toBeNull();
  });
});

describe("needs", () => {
  test("liste les needs du job", () => {
    renderPanel(
      job({
        needs: {
          value: [
            { job: "prepare", optional: false, artifacts: true },
            { job: "lint", optional: true, artifacts: false },
          ],
          origin: { kind: "local" },
        },
      }),
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.includes("prepare"))).toContain(true);
    expect(items.map((item) => item.textContent?.includes("lint"))).toContain(true);
  });

  test("marque un need optionnel", () => {
    renderPanel(
      job({
        needs: {
          value: [{ job: "lint", optional: true, artifacts: true }],
          origin: { kind: "local" },
        },
      }),
    );
    expect(screen.getByText(/optional/i)).toBeDefined();
  });

  test("marque un need sans artefacts", () => {
    renderPanel(
      job({
        needs: {
          value: [{ job: "lint", optional: false, artifacts: false }],
          origin: { kind: "local" },
        },
      }),
    );
    expect(screen.getByText(/no artifacts/i)).toBeDefined();
  });

  test("dit explicitement quand le job n'a aucun need", () => {
    renderPanel(job());
    expect(screen.getByText(/no dependencies/i)).toBeDefined();
  });

  test("des needs hérités portent leur badge d'origine", () => {
    renderPanel(
      job({
        needs: {
          value: [{ job: "prepare", optional: false, artifacts: true }],
          origin: { kind: "extends", template: ".base" },
        },
      }),
    );
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "inherited from .base",
    );
  });
});

describe("environnement", () => {
  test("affiche le nom de l'environnement", () => {
    renderPanel(job({ environment: { value: { name: "production" }, origin: { kind: "local" } } }));
    expect(screen.getByTestId("job-environment").textContent).toContain("production");
  });

  test("affiche l'URL et l'action quand elles existent", () => {
    renderPanel(
      job({
        environment: {
          value: { name: "staging", url: "https://staging.example.org", action: "start" },
          origin: { kind: "local" },
        },
      }),
    );
    const section = screen.getByTestId("job-environment");
    expect(section.textContent).toContain("https://staging.example.org");
    expect(section.textContent).toContain("start");
  });

  test("dit explicitement qu'il n'y a pas d'environnement", () => {
    renderPanel(job());
    expect(screen.getByTestId("job-environment").textContent).toMatch(/none/i);
  });
});

describe("extends", () => {
  test("liste les templates étendus dans l'ordre déclaré", () => {
    renderPanel(job({ extends: [".premier", ".second"] }));
    const section = screen.getByTestId("job-extends");
    expect(section.textContent).toContain(".premier");
    expect(section.textContent).toContain(".second");
  });

  test("masque la section quand le job n'étend rien", () => {
    renderPanel(job());
    expect(screen.queryByTestId("job-extends")).toBeNull();
  });
});

describe("blocs opaques", () => {
  test("un bloc par clé non modélisée, nommé par sa clé", () => {
    renderPanel(job({ opaque: [SCRIPT_BLOCK, ARTIFACTS_BLOCK] }));
    expect(screen.getByRole("group", { name: /script/ })).toBeDefined();
    expect(screen.getByRole("group", { name: /artifacts/ })).toBeDefined();
  });

  test("le bloc est annoncé en lecture seule", () => {
    renderPanel(job());
    expect(screen.getByRole("group", { name: /script/ }).textContent).toMatch(/read-only/i);
  });

  test("le contenu du bloc est le texte source découpé par sa plage", async () => {
    renderPanel(job());
    const editor = await screen.findByTestId("opaque-editor-script");
    expect(editor.textContent).toContain("make all");
    expect(editor.textContent).toContain("make check");
  });

  test("aucun bloc opaque affiche un état vide", () => {
    renderPanel(job({ opaque: [] }));
    expect(screen.getByText(/no opaque blocks/i)).toBeDefined();
  });
});

describe("origines combinées", () => {
  test("chaque valeur héritée est signalée indépendamment", () => {
    const inherited: Origin = { kind: "extends", template: ".base" };
    renderPanel(
      job({
        stage: { value: "test", origin: inherited },
        needs: {
          value: [{ job: "prepare", optional: false, artifacts: true }],
          origin: { kind: "anchor", name: "defaults" },
        },
      }),
    );
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "inherited from .base",
    );
    expect(screen.getAllByTestId("origin-badge").map((badge) => badge.textContent)).toContain(
      "from anchor &defaults",
    );
  });
});

describe("bloc opaque dont la plage ne peut pas être lue", () => {
  /** `sliceOpaque` rendait `""` sur une plage hors bornes ou inversée, ce qu'un bloc vide rend
   *  aussi : la seule surface dont la promesse est « ceci est verbatim » ne savait pas dire
   *  qu'elle ne savait pas. Le principe 3 de PRODUCT.md impose de montrer l'incertitude. */
  const BROKEN = { key: "script", range: { start: 9000, end: 9100 }, file: MAIN };

  test("sliceOpaque distingue l'illisible du vide", () => {
    expect(sliceOpaque("", { key: "script", range: { start: 0, end: 0 }, file: MAIN })).toBeNull();
    expect(sliceOpaque(TEXT, BROKEN)).toBeNull();
  });

  test("le panneau le dit explicitement au lieu d'afficher un cadre vide", () => {
    renderPanel(job({ opaque: [BROKEN] }));

    const block = screen.getByRole("group", { name: "Opaque block script" });
    expect(block.textContent).toContain("Content unavailable");
    expect(block.textContent).toContain("still on disk");
  });
});
