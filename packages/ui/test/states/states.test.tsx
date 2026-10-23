import { afterEach, describe, expect, test } from "bun:test";
import type { Diagnostic } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Notice } from "../../src/state/store.ts";
import { DocumentRemoved } from "../../src/states/DocumentRemoved.tsx";
import { InvalidDocument } from "../../src/states/InvalidDocument.tsx";
import { Loading } from "../../src/states/Loading.tsx";
import { NoCiFile } from "../../src/states/NoCiFile.tsx";
import { NoticeBar } from "../../src/states/NoticeBar.tsx";

afterEach(cleanup);

function error(detail = "broken"): Diagnostic {
  return {
    code: "INVALID_YAML",
    severity: "error",
    params: { detail },
    range: { start: 0, end: 4 },
  };
}

describe("Loading", () => {
  test("annonce le chargement à un lecteur d'écran", () => {
    render(<Loading />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/loading/i);
  });

  test("le statut est poli, pour ne pas couper la lecture en cours", () => {
    render(<Loading />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});

describe("NoCiFile", () => {
  test("dit qu'aucun fichier CI n'a été détecté", () => {
    render(<NoCiFile root="/depot" />);
    expect(screen.getByRole("heading", { name: /no ci file/i })).toBeDefined();
  });

  test("nomme le dossier inspecté, pour que l'utilisateur sache où Keelson a cherché", () => {
    render(<NoCiFile root="/depot/mon-projet" />);
    expect(screen.getByText(/\/depot\/mon-projet/)).toBeDefined();
  });

  test("nomme le fichier attendu", () => {
    render(<NoCiFile root="/depot" />);
    expect(screen.getByText(/\.gitlab-ci\.yml/)).toBeDefined();
  });

  test("n'offre aucune action d'édition", () => {
    render(<NoCiFile root="/depot" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("InvalidDocument", () => {
  test("dit que le fichier est invalide et que l'édition est désactivée", () => {
    render(<InvalidDocument diagnostics={[error()]} />);
    expect(screen.getByRole("heading", { name: /cannot be parsed/i })).toBeDefined();
    expect(screen.getByText(/editing is disabled/i)).toBeDefined();
  });

  test("affiche les diagnostics qui bloquent", () => {
    render(<InvalidDocument diagnostics={[error("inconsistent indentation")]} />);
    expect(screen.getByText(/inconsistent indentation/)).toBeDefined();
  });

  test("n'affiche que les diagnostics d'erreur", () => {
    render(
      <InvalidDocument
        diagnostics={[
          error("blocking"),
          { code: "JOB_WITHOUT_SCRIPT", severity: "warning", params: { job: "muet" }, range: null },
        ]}
      />,
    );
    expect(screen.getByText(/blocking/)).toBeDefined();
    expect(screen.queryByText(/muet/)).toBeNull();
  });

  test("dit que le fichier reste intact sur disque", () => {
    render(<InvalidDocument diagnostics={[error()]} />);
    expect(screen.getByText(/untouched/i)).toBeDefined();
  });

  test("le bloc est une alerte pour un lecteur d'écran", () => {
    render(<InvalidDocument diagnostics={[error()]} />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});

describe("DocumentRemoved", () => {
  test("dit que le fichier a été supprimé sur disque", () => {
    render(<DocumentRemoved file=".gitlab-ci.yml" />);
    expect(screen.getByRole("heading", { name: /deleted/i })).toBeDefined();
  });

  test("nomme le fichier disparu", () => {
    render(<DocumentRemoved file="ci/pipeline.yml" />);
    expect(screen.getByText(/ci\/pipeline\.yml/)).toBeDefined();
  });

  test("dit que Keelson reprendra si le fichier revient", () => {
    render(<DocumentRemoved file=".gitlab-ci.yml" />);
    expect(screen.getByText(/reappears/i)).toBeDefined();
  });

  test("le bloc est une alerte", () => {
    render(<DocumentRemoved file=".gitlab-ci.yml" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});

describe("NoticeBar", () => {
  function notice(kind: Notice["kind"], message = "quelque chose a changé"): Notice {
    return { kind, message } as Notice;
  }

  test("n'affiche rien sans notice", () => {
    const { container } = render(<NoticeBar notice={null} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });

  test("affiche le message de la notice", () => {
    render(
      <NoticeBar notice={notice("reloaded", "rechargé depuis le disque")} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/rechargé depuis le disque/)).toBeDefined();
  });

  test("une notice stale est une alerte, elle porte une conséquence", () => {
    render(<NoticeBar notice={notice("stale")} onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("une notice reloaded est un statut poli, elle est informative", () => {
    render(<NoticeBar notice={notice("reloaded")} onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  test("chaque variante est nommée en texte, pas seulement par la couleur", () => {
    for (const [kind, label] of [
      ["stale", /not applied/i],
      ["reloaded", /reloaded/i],
      ["removed", /deleted/i],
    ] as const) {
      cleanup();
      render(<NoticeBar notice={notice(kind)} onDismiss={() => {}} />);
      expect(screen.getByTestId("notice-kind").textContent).toMatch(label);
    }
  });

  test("la notice est refermable", async () => {
    let dismissed = 0;
    render(
      <NoticeBar
        notice={notice("reloaded")}
        onDismiss={() => {
          dismissed += 1;
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(dismissed).toBe(1);
  });

  test("le bouton de fermeture est atteignable au clavier", () => {
    render(<NoticeBar notice={notice("stale")} onDismiss={() => {}} />);
    expect(screen.getByRole("button", { name: /dismiss/i }).getAttribute("tabindex")).not.toBe(
      "-1",
    );
  });
});
