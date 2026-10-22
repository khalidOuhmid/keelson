import { afterEach, describe, expect, test } from "bun:test";
import type { Job, Pipeline } from "@keelson/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobEditor } from "../../src/editing/JobEditor.tsx";
import { NewJobForm } from "../../src/editing/NewJobForm.tsx";
import { StageControls } from "../../src/editing/StageControls.tsx";
import type { Draft } from "../../src/state/store.ts";

afterEach(cleanup);

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "unit",
    stage: { value: "test", origin: { kind: "local" } },
    needs: null,
    environment: null,
    extends: [],
    opaque: [],
    range: { start: 0, end: 10 },
    ...overrides,
  };
}

const PIPELINE: Pipeline = {
  stages: ["build", "test", "deploy"].map((name) => ({ name, implicit: false, range: null })),
  jobs: [
    job({ id: "compile", stage: { value: "build", origin: { kind: "local" } } }),
    job(),
    job({ id: "lint" }),
  ],
  templates: [],
  opaque: [],
};

function collector() {
  const drafts: Draft[] = [];
  return { drafts, submit: (draft: Draft) => drafts.push(draft) };
}

describe("JobEditor — renommer", () => {
  test("renomme le job avec la valeur saisie", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    const field = screen.getByRole("textbox", { name: /job id/i });
    await userEvent.clear(field);
    await userEvent.type(field, "tests-unitaires");
    await userEvent.click(screen.getByRole("button", { name: /rename/i }));

    expect(drafts).toEqual([{ kind: "renameJob", from: "unit", to: "tests-unitaires" }]);
  });

  test("le renommage est soumis au clavier par Entrée", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    const field = screen.getByRole("textbox", { name: /job id/i });
    await userEvent.clear(field);
    await userEvent.type(field, "autre{Enter}");

    expect(drafts).toEqual([{ kind: "renameJob", from: "unit", to: "autre" }]);
  });

  test("ne soumet rien si le nom n'a pas changé", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect(drafts).toEqual([]);
  });
});

describe("JobEditor — stage", () => {
  test("change le stage par le sélecteur puis le bouton dédié", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "deploy");
    await userEvent.click(screen.getByRole("button", { name: "Move to stage" }));
    expect(drafts).toEqual([{ kind: "setJobStage", id: "unit", stage: "deploy" }]);
  });

  test("le sélecteur propose tous les stages du pipeline", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} />);
    const options = screen
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    for (const stage of ["build", "test", "deploy"]) {
      expect(options).toContain(stage);
    }
  });

  test("choisir le stage courant ne soumet rien", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /stage/i }), "test");
    expect(drafts).toEqual([]);
  });
});

describe("JobEditor — needs", () => {
  test("ajoute un need vers un autre job", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /add a need/i }), "compile");
    await userEvent.click(screen.getByRole("button", { name: /add need/i }));
    expect(drafts).toEqual([{ kind: "addNeed", id: "unit", need: { job: "compile" } }]);
  });

  test("le sélecteur de need exclut le job lui-même", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} />);
    const select = screen.getByRole("combobox", { name: /add a need/i });
    const values = [...select.querySelectorAll("option")].map((option) => option.value);
    expect(values).not.toContain("unit");
    expect(values).toContain("compile");
  });

  test("le sélecteur exclut les jobs déjà requis", () => {
    render(
      <JobEditor
        job={job({
          needs: {
            value: [{ job: "compile", optional: false, artifacts: true }],
            origin: { kind: "local" },
          },
        })}
        pipeline={PIPELINE}
        onSubmit={() => {}}
      />,
    );
    const select = screen.getByRole("combobox", { name: /add a need/i });
    const values = [...select.querySelectorAll("option")].map((option) => option.value);
    expect(values).not.toContain("compile");
  });

  test("ajoute un need optionnel sans artefacts", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /add a need/i }), "compile");
    await userEvent.click(screen.getByRole("checkbox", { name: /optional/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /artifacts/i }));
    await userEvent.click(screen.getByRole("button", { name: /add need/i }));
    expect(drafts).toEqual([
      { kind: "addNeed", id: "unit", need: { job: "compile", optional: true, artifacts: false } },
    ]);
  });

  test("retire un need existant", async () => {
    const { drafts, submit } = collector();
    render(
      <JobEditor
        job={job({
          needs: {
            value: [{ job: "compile", optional: false, artifacts: true }],
            origin: { kind: "local" },
          },
        })}
        pipeline={PIPELINE}
        onSubmit={submit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove need compile/i }));
    expect(drafts).toEqual([{ kind: "removeNeed", id: "unit", job: "compile" }]);
  });
});

describe("JobEditor — environnement", () => {
  test("définit l'environnement", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /environment name/i }), "production");
    await userEvent.click(screen.getByRole("button", { name: /set environment/i }));
    expect(drafts).toEqual([
      { kind: "setEnvironment", id: "unit", environment: { name: "production" } },
    ]);
  });

  test("porte l'URL quand elle est renseignée", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /environment name/i }), "staging");
    await userEvent.type(
      screen.getByRole("textbox", { name: /environment url/i }),
      "https://s.example.org",
    );
    await userEvent.click(screen.getByRole("button", { name: /set environment/i }));
    expect(drafts).toEqual([
      {
        kind: "setEnvironment",
        id: "unit",
        environment: { name: "staging", url: "https://s.example.org" },
      },
    ]);
  });

  test("ne soumet rien sans nom d'environnement", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /set environment/i }));
    expect(drafts).toEqual([]);
  });

  test("retire l'environnement existant", async () => {
    const { drafts, submit } = collector();
    render(
      <JobEditor
        job={job({ environment: { value: { name: "production" }, origin: { kind: "local" } } })}
        pipeline={PIPELINE}
        onSubmit={submit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove environment/i }));
    expect(drafts).toEqual([{ kind: "setEnvironment", id: "unit", environment: null }]);
  });

  test("le bouton de retrait est absent quand il n'y a pas d'environnement", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(screen.queryByRole("button", { name: /remove environment/i })).toBeNull();
  });
});

describe("JobEditor — suppression", () => {
  test("supprime le job, une fois la suppression confirmée", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete unit" }));
    expect(drafts).toEqual([{ kind: "removeJob", id: "unit" }]);
  });
});

describe("JobEditor — édition désactivée", () => {
  test("tous les contrôles sont désactivés", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} disabled />);
    for (const control of [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("combobox"),
    ]) {
      expect(control.hasAttribute("disabled")).toBe(true);
    }
  });

  test("aucune opération ne part quand c'est désactivé", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} disabled />);
    await userEvent.click(screen.getByRole("button", { name: /delete job/i }));
    expect(drafts).toEqual([]);
  });
});

describe("NewJobForm", () => {
  test("crée un job avec son identifiant, son stage et son script", async () => {
    const { drafts, submit } = collector();
    render(<NewJobForm pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.type(screen.getByRole("textbox", { name: /new job id/i }), "paquet");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /new job stage/i }),
      "deploy",
    );
    await userEvent.type(screen.getByRole("textbox", { name: /script/i }), "make package");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));

    expect(drafts).toEqual([
      { kind: "addJob", job: { id: "paquet", stage: "deploy", script: ["make package"] } },
    ]);
  });

  test("découpe un script multi-lignes", async () => {
    const { drafts, submit } = collector();
    render(<NewJobForm pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new job id/i }), "paquet");
    await userEvent.type(screen.getByRole("textbox", { name: /script/i }), "npm ci{Enter}npm test");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));
    expect((drafts[0] as { job: { script: string[] } }).job.script).toEqual(["npm ci", "npm test"]);
  });

  test("ne soumet rien sans identifiant", async () => {
    const { drafts, submit } = collector();
    render(<NewJobForm pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /script/i }), "x");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));
    expect(drafts).toEqual([]);
  });

  test("ne soumet rien sans script", async () => {
    const { drafts, submit } = collector();
    render(<NewJobForm pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new job id/i }), "paquet");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));
    expect(drafts).toEqual([]);
  });

  test("le premier stage du pipeline est proposé par défaut", () => {
    render(<NewJobForm pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(
      (screen.getByRole("combobox", { name: /new job stage/i }) as HTMLSelectElement).value,
    ).toBe("build");
  });
});

describe("StageControls", () => {
  test("ajoute un stage en fin de liste", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    expect(drafts).toEqual([{ kind: "addStage", name: "verify" }]);
  });

  test("ajoute un stage à la position choisie", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /insert at/i }), "0");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    expect(drafts).toEqual([{ kind: "addStage", name: "verify", index: 0 }]);
  });

  test("ne soumet rien sans nom de stage", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    expect(drafts).toEqual([]);
  });

  test("déplace un stage vers la gauche au clavier", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /move deploy earlier/i }));
    expect(drafts).toEqual([{ kind: "moveStage", name: "deploy", toIndex: 1 }]);
  });

  test("déplace un stage vers la droite au clavier", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /move build later/i }));
    expect(drafts).toEqual([{ kind: "moveStage", name: "build", toIndex: 1 }]);
  });

  test("le premier stage ne peut pas reculer", () => {
    render(<StageControls pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(
      screen.getByRole("button", { name: /move build earlier/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("le dernier stage ne peut pas avancer", () => {
    render(<StageControls pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(
      screen.getByRole("button", { name: /move deploy later/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("tous les contrôles sont désactivés quand l'édition l'est", () => {
    render(<StageControls pipeline={PIPELINE} onSubmit={() => {}} disabled />);
    for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("textbox")]) {
      expect(control.hasAttribute("disabled")).toBe(true);
    }
  });
});

describe("JobEditor — l'environnement affiché est celui du job", () => {
  /** Trouvé par /impeccable critique le 2026-10-22 : le panneau de détail affichait
   *  `name: production` pendant que l'éditeur en dessous montrait deux champs vides. */
  const withEnvironment = job({
    environment: {
      value: { name: "production", url: "https://app.example.org" },
      origin: { kind: "local" },
    },
  });

  test("les champs sont pré-remplis depuis le job", () => {
    render(<JobEditor job={withEnvironment} pipeline={PIPELINE} onSubmit={() => undefined} />);

    expect(
      (screen.getByRole("textbox", { name: "Environment name" }) as HTMLInputElement).value,
    ).toBe("production");
    expect(
      (screen.getByRole("textbox", { name: "Environment url" }) as HTMLInputElement).value,
    ).toBe("https://app.example.org");
  });

  test("les champs restent vides quand le job n'a pas d'environnement", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => undefined} />);

    expect(
      (screen.getByRole("textbox", { name: "Environment name" }) as HTMLInputElement).value,
    ).toBe("");
  });
});

describe("JobEditor — aucune écriture sans geste explicite", () => {
  /** ADR 0004. Trouvé par /impeccable critique le 2026-10-22 : le select de stage soumettait sur
   *  `onChange`, or sous Windows et Linux les flèches dans un select fermé émettent `change` à
   *  chaque appui — un utilisateur au clavier qui parcourt les options réécrivait son YAML une fois
   *  par touche. La suppression, elle, réécrivait le fichier sur un seul clic. */
  test("choisir un stage ne soumet rien", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "deploy");

    expect(drafts).toEqual([]);
  });

  test("le stage n'est soumis que par le bouton dédié", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "deploy");
    await userEvent.click(screen.getByRole("button", { name: "Move to stage" }));

    expect(drafts).toEqual([{ kind: "setJobStage", id: "unit", stage: "deploy" }]);
  });

  test("le bouton de stage est inerte quand le stage affiché est déjà celui du job", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.click(screen.getByRole("button", { name: "Move to stage" }));

    expect(drafts).toEqual([]);
  });

  test("supprimer un job demande confirmation avant d'écrire", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));

    expect(drafts).toEqual([]);
    expect(screen.getByRole("alertdialog", { name: /delete/i }).textContent).toContain("unit");
  });

  test("la confirmation écrit, l'annulation ne fait rien", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(drafts).toEqual([]);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete unit" }));
    expect(drafts).toEqual([{ kind: "removeJob", id: "unit" }]);
  });
});
