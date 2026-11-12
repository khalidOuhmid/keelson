import { afterEach, describe, expect, test } from "bun:test";
import type { Job, Pipeline } from "@keelson/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobEditor } from "../../src/editing/JobEditor.tsx";
import { NewJobForm } from "../../src/editing/NewJobForm.tsx";
import { StageControls } from "../../src/editing/StageControls.tsx";
import type { Draft } from "../../src/state/store.ts";

const MAIN = ".gitlab-ci.yml";

afterEach(cleanup);

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "unit",
    stage: { value: "test", origin: { kind: "local" } },
    needs: null,
    environment: null,
    extends: [],
    opaque: [],
    signals: { image: null, script: [] },
    range: { start: 0, end: 10 },
    file: MAIN,
    ...overrides,
  };
}

const PIPELINE: Pipeline = {
  stages: ["build", "test", "deploy"].map((name) => ({
    name,
    implicit: false,
    range: null,
    file: MAIN,
  })),
  jobs: [
    job({ id: "compile", stage: { value: "build", origin: { kind: "local" } } }),
    job(),
    job({ id: "lint" }),
  ],
  templates: [],
  opaque: [],
  main: MAIN,
  files: [MAIN],
  unresolved: [],
};

function collector() {
  const drafts: Draft[] = [];
  return { drafts, submit: (draft: Draft) => drafts.push(draft) };
}

describe("JobEditor — rename", () => {
  test("renames the job with the typed value", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    const field = screen.getByRole("textbox", { name: /job id/i });
    await userEvent.clear(field);
    await userEvent.type(field, "tests-unitaires");
    await userEvent.click(screen.getByRole("button", { name: /rename/i }));

    expect(drafts).toEqual([{ kind: "renameJob", from: "unit", to: "tests-unitaires" }]);
  });

  test("the rename is submitted from the keyboard with Enter", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    const field = screen.getByRole("textbox", { name: /job id/i });
    await userEvent.clear(field);
    await userEvent.type(field, "autre{Enter}");

    expect(drafts).toEqual([{ kind: "renameJob", from: "unit", to: "autre" }]);
  });

  test("submits nothing if the name did not change", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /rename/i }));
    expect(drafts).toEqual([]);
  });
});

describe("JobEditor — stage", () => {
  test("changes the stage with the select then the dedicated button", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "deploy");
    await userEvent.click(screen.getByRole("button", { name: "Move to stage" }));
    expect(drafts).toEqual([{ kind: "setJobStage", id: "unit", stage: "deploy" }]);
  });

  test("the select offers every stage of the pipeline", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} />);
    const options = screen
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    for (const stage of ["build", "test", "deploy"]) {
      expect(options).toContain(stage);
    }
  });

  test("choosing the current stage submits nothing", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /stage/i }), "test");
    expect(drafts).toEqual([]);
  });
});

describe("JobEditor — needs", () => {
  test("adds a need on another job", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /add a need/i }), "compile");
    await userEvent.click(screen.getByRole("button", { name: /add need/i }));
    expect(drafts).toEqual([{ kind: "addNeed", id: "unit", need: { job: "compile" } }]);
  });

  test("the need select excludes the job itself", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} />);
    const select = screen.getByRole("combobox", { name: /add a need/i });
    const values = [...select.querySelectorAll("option")].map((option) => option.value);
    expect(values).not.toContain("unit");
    expect(values).toContain("compile");
  });

  test("the select excludes jobs already needed", () => {
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

  test("adds an optional need without artifacts", async () => {
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

  test("removes an existing need", async () => {
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

describe("JobEditor — environment", () => {
  test("sets the environment", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /environment name/i }), "production");
    await userEvent.click(screen.getByRole("button", { name: /set environment/i }));
    expect(drafts).toEqual([
      { kind: "setEnvironment", id: "unit", environment: { name: "production" } },
    ]);
  });

  test("carries the URL when filled in", async () => {
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

  test("submits nothing without an environment name", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /set environment/i }));
    expect(drafts).toEqual([]);
  });

  test("removes the existing environment", async () => {
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

  test("the remove button is absent when there is no environment", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(screen.queryByRole("button", { name: /remove environment/i })).toBeNull();
  });
});

describe("JobEditor — deletion", () => {
  test("deletes the job, once the deletion is confirmed", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete unit" }));
    expect(drafts).toEqual([{ kind: "removeJob", id: "unit" }]);
  });
});

describe("JobEditor — editing disabled", () => {
  test("all controls are disabled", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => {}} disabled />);
    for (const control of [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("combobox"),
    ]) {
      expect(control.hasAttribute("disabled")).toBe(true);
    }
  });

  test("no operation is sent when disabled", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} disabled />);
    await userEvent.click(screen.getByRole("button", { name: /delete job/i }));
    expect(drafts).toEqual([]);
  });

  test("a submission that bypasses the disabled controls still sends nothing", () => {
    // `disabled` on every control is the first barrier, and the tests above only reach it. A
    // form submission is not stopped by a disabled field: a change event and a programmatic
    // submit reach the handlers directly, so only the second barrier, the editor's own check of
    // `disabled`, stands between them and an operation.
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} disabled />);
    const field = screen.getByRole("textbox", { name: /job id/i });
    fireEvent.change(field, { target: { value: "renamed" } });
    const form = field.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(drafts).toEqual([]);
  });
});

describe("NewJobForm", () => {
  test("creates a job with its id, its stage and its script", async () => {
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

  test("splits a multi-line script", async () => {
    const { drafts, submit } = collector();
    render(<NewJobForm pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new job id/i }), "paquet");
    await userEvent.type(screen.getByRole("textbox", { name: /script/i }), "npm ci{Enter}npm test");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));
    expect((drafts[0] as { job: { script: string[] } }).job.script).toEqual(["npm ci", "npm test"]);
  });

  test("submits nothing without an id", async () => {
    const { drafts, submit } = collector();
    render(<NewJobForm pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /script/i }), "x");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));
    expect(drafts).toEqual([]);
  });

  test("submits nothing without a script", async () => {
    const { drafts, submit } = collector();
    render(<NewJobForm pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new job id/i }), "paquet");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));
    expect(drafts).toEqual([]);
  });

  test("the pipeline's first stage is offered by default", () => {
    render(<NewJobForm pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(
      (screen.getByRole("combobox", { name: /new job stage/i }) as HTMLSelectElement).value,
    ).toBe("build");
  });
});

describe("StageControls", () => {
  test("adds a stage at the end of the list", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    expect(drafts).toEqual([{ kind: "addStage", name: "verify" }]);
  });

  test("adds a stage at the chosen position", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.type(screen.getByRole("textbox", { name: /new stage name/i }), "verify");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /insert at/i }), "0");
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    expect(drafts).toEqual([{ kind: "addStage", name: "verify", index: 0 }]);
  });

  test("submits nothing without a stage name", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /add stage/i }));
    expect(drafts).toEqual([]);
  });

  test("moves a stage left from the keyboard", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /move deploy earlier/i }));
    expect(drafts).toEqual([{ kind: "moveStage", name: "deploy", toIndex: 1 }]);
  });

  test("moves a stage right from the keyboard", async () => {
    const { drafts, submit } = collector();
    render(<StageControls pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /move build later/i }));
    expect(drafts).toEqual([{ kind: "moveStage", name: "build", toIndex: 1 }]);
  });

  test("the first stage cannot move back", () => {
    render(<StageControls pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(
      screen.getByRole("button", { name: /move build earlier/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("the last stage cannot move forward", () => {
    render(<StageControls pipeline={PIPELINE} onSubmit={() => {}} />);
    expect(
      screen.getByRole("button", { name: /move deploy later/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("all controls are disabled when editing is", () => {
    render(<StageControls pipeline={PIPELINE} onSubmit={() => {}} disabled />);
    for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("textbox")]) {
      expect(control.hasAttribute("disabled")).toBe(true);
    }
  });
});

describe("JobEditor — the displayed environment is the job's", () => {
  /** Found by /impeccable critique on 2026-10-22: the detail panel showed `name: production`
   *  while the editor below showed two empty fields. */
  const withEnvironment = job({
    environment: {
      value: { name: "production", url: "https://app.example.org" },
      origin: { kind: "local" },
    },
  });

  test("the fields are prefilled from the job", () => {
    render(<JobEditor job={withEnvironment} pipeline={PIPELINE} onSubmit={() => undefined} />);

    expect(
      (screen.getByRole("textbox", { name: "Environment name" }) as HTMLInputElement).value,
    ).toBe("production");
    expect(
      (screen.getByRole("textbox", { name: "Environment url" }) as HTMLInputElement).value,
    ).toBe("https://app.example.org");
  });

  test("the fields stay empty when the job has no environment", () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => undefined} />);

    expect(
      (screen.getByRole("textbox", { name: "Environment name" }) as HTMLInputElement).value,
    ).toBe("");
  });
});

describe("JobEditor — no write without an explicit gesture", () => {
  /** ADR 0004. Found by /impeccable critique on 2026-10-22: the stage select submitted on
   *  `onChange`, yet on Windows and Linux the arrow keys in a closed select emit `change` on every
   *  press — a keyboard user browsing the options rewrote their YAML once per key. Deletion, for
   *  its part, rewrote the file on a single click. */
  test("choosing a stage submits nothing", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "deploy");

    expect(drafts).toEqual([]);
  });

  test("the stage is only submitted by the dedicated button", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "deploy");
    await userEvent.click(screen.getByRole("button", { name: "Move to stage" }));

    expect(drafts).toEqual([{ kind: "setJobStage", id: "unit", stage: "deploy" }]);
  });

  test("the stage button is inert when the displayed stage is already the job's", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.click(screen.getByRole("button", { name: "Move to stage" }));

    expect(drafts).toEqual([]);
  });

  test("deleting a job asks for confirmation before writing", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));

    expect(drafts).toEqual([]);
    expect(screen.getByRole("alertdialog", { name: /delete/i }).textContent).toContain("unit");
  });

  test("confirming writes, cancelling does nothing", async () => {
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

describe("JobEditor — the confirmation is usable from the keyboard", () => {
  /** 2026-10-22 independent review: on open, focus stayed on the trigger and never entered the
   *  dialog; `aria-modal` was missing; Escape closed the whole detail panel instead of cancelling
   *  the dialog; and focus fell back onto `<body>` at the product's most destructive moment. */
  test("focus moves into the dialog on open", async () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete unit" }));
  });

  test("the dialog is announced as modal", async () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));

    expect(screen.getByRole("alertdialog").getAttribute("aria-modal")).toBe("true");
  });

  test("Escape cancels the dialog and returns focus to the trigger", async () => {
    const { drafts, submit } = collector();
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(drafts).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete job" }));
  });

  test("Cancel also returns focus to the trigger", async () => {
    render(<JobEditor job={job()} pipeline={PIPELINE} onSubmit={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete job" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete job" }));
  });
});

describe("JobEditor — the need select and the button point to the same job", () => {
  /** Second independent review of 2026-10-22: `needTarget` was only initialised on first mount,
   *  and `JobEditor` is only re-keyed on `job.id`. After an addition, the target vanished from the
   *  option list; the browser showed option 0 while React kept the old value, and `Add need`
   *  submitted that one. Same class as the mount without `key`: editing writes a value the user
   *  did not enter. */
  function withNeeds(needs: string[]) {
    return job({
      id: "unit",
      needs:
        needs.length === 0
          ? null
          : {
              value: needs.map((target) => ({ job: target, optional: false, artifacts: true })),
              origin: { kind: "local" as const },
            },
    });
  }

  test("the submitted target is the one the select shows", async () => {
    const { drafts, submit } = collector();
    const view = render(<JobEditor job={withNeeds([])} pipeline={PIPELINE} onSubmit={submit} />);

    // `compile` becomes needed: it leaves the candidate list without remounting the component.
    view.rerender(<JobEditor job={withNeeds(["compile"])} pipeline={PIPELINE} onSubmit={submit} />);

    const select = screen.getByRole("combobox", { name: /add a need/i }) as HTMLSelectElement;
    await userEvent.click(screen.getByRole("button", { name: /add need/i }));

    expect(drafts).toEqual([{ kind: "addNeed", id: "unit", need: { job: select.value } }]);
  });

  test("the button is inert when no candidate is left", () => {
    render(
      <JobEditor
        job={withNeeds(["compile", "lint"])}
        pipeline={PIPELINE}
        onSubmit={() => undefined}
      />,
    );

    expect((screen.getByRole("button", { name: /add need/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
