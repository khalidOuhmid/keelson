import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Tool } from "@keelson/catalog";
import { emptyPipeline, type Job, type Pipeline } from "@keelson/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiResult, OperationPayload } from "../src/api/client.ts";
import { diffRows, visibleRows } from "../src/editing/diff.ts";
import { InsertTool } from "../src/views/catalog/InsertTool.tsx";

const SNIPPET = "trivy:\n  stage: test\n  script:\n    - trivy fs .\n";

const TOOL = {
  id: "trivy",
  name: "Trivy",
  snippets: { gitlab: SNIPPET, github: null },
} as unknown as Tool;

const PIPELINE: Pipeline = {
  ...emptyPipeline(".gitlab-ci.yml"),
  stages: [{ name: "build" }, { name: "test" }] as Pipeline["stages"],
  jobs: [{ id: "compile" } as Job],
};

const BEFORE = "stages:\n  - test\n";
const AFTER = `${BEFORE}\ntrivy:\n  stage: test\n`;

function payload(text = AFTER, layers: string[] = ["sca"]): ApiResult<OperationPayload> {
  return {
    ok: true,
    value: {
      text,
      coverage: { jobs: [{ job: "trivy", layers, tools: [], overridden: false }] },
    } as unknown as OperationPayload,
  };
}

function setup(preview = mock(async () => payload()), pipeline = PIPELINE, disabled = false) {
  const onInsert = mock(async () => true);
  render(
    <InsertTool
      tool={TOOL}
      pipeline={pipeline}
      text={BEFORE}
      disabled={disabled}
      preview={preview}
      onInsert={onInsert}
    />,
  );
  return { preview, onInsert };
}

afterEach(cleanup);

describe("diff par lignes", () => {
  test("les lignes communes restent, les autres sont marquées", () => {
    expect(diffRows("a\nb\nc\n", "a\nx\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  test("deux régions éloignées restent deux régions", () => {
    const middle = Array.from({ length: 20 }, (_, index) => `l${index}`).join("\n");
    const rows = diffRows(`a\n${middle}\nz\n`, `A\n${middle}\nZ\n`);
    expect(rows.filter((row) => row.kind !== "same")).toHaveLength(4);
    const visible = visibleRows(rows, 2);
    expect(visible.some((row) => row.kind === "gap")).toBe(true);
    expect(visible.filter((row) => row.kind === "same")).toHaveLength(4);
  });

  test("un fichier énorme ne bloque pas : tout le milieu change", () => {
    const left = Array.from({ length: 5000 }, (_, index) => `a${index}`).join("\n");
    const right = Array.from({ length: 5000 }, (_, index) => `b${index}`).join("\n");
    const started = performance.now();
    expect(diffRows(left, right).length).toBe(10000);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("insertion depuis la fiche", () => {
  test("rien ne part avant d'ouvrir", () => {
    const { preview } = setup();
    expect(preview).not.toHaveBeenCalled();
  });

  async function open() {
    await userEvent.click(screen.getByRole("button", { name: "Add to pipeline" }));
  }

  test("le diff et la couche couverte s'affichent avant toute écriture", async () => {
    const { onInsert } = setup();
    await open();
    await screen.findByText("+trivy:");
    expect(screen.getByTestId("insert-diff").textContent).toContain("+trivy:");
    expect(screen.getByTestId("insert-layers").textContent).toContain("SCA");
    expect(onInsert).not.toHaveBeenCalled();
  });

  test("le stage du snippet est repris, le nom est libre", async () => {
    const { preview } = setup();
    await open();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(preview).toHaveBeenCalledWith({
      kind: "addSnippet",
      id: "trivy",
      stage: "test",
      snippet: SNIPPET,
    });
  });

  test("un nom pris reçoit un suffixe", async () => {
    const { preview } = setup(
      mock(async () => payload()),
      {
        ...PIPELINE,
        jobs: [{ id: "trivy" } as Job],
      },
    );
    await open();
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(expect.objectContaining({ id: "trivy-2" })),
    );
  });

  test("un stage absent s'annonce, et l'opération devient composite", async () => {
    const { preview } = setup(
      mock(async () => payload()),
      {
        ...PIPELINE,
        stages: [{ name: "build" }] as Pipeline["stages"],
      },
    );
    await open();
    expect(screen.getByRole("option", { name: "test (new stage)" })).toBeDefined();
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith({
        kind: "composite",
        steps: [
          { kind: "addStage", name: "test" },
          { kind: "addSnippet", id: "trivy", stage: "test", snippet: SNIPPET },
        ],
      }),
    );
  });

  test("insérer envoie la même opération", async () => {
    const { onInsert } = setup();
    await open();
    await screen.findByText("+trivy:");
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "addSnippet", id: "trivy" }),
      "trivy",
    );
  });

  test("un refus se dit en clair et coupe Insert", async () => {
    setup(
      mock(
        async () =>
          ({
            ok: false,
            error: { status: 422, code: "NAME_CONFLICT", params: { name: "trivy" } },
          }) as ApiResult<OperationPayload>,
      ),
    );
    await open();
    await screen.findByText(/already exists/);
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("une réponse d'un ancien nom ne remplace pas la dernière", async () => {
    let first: (value: ApiResult<OperationPayload>) => void = () => {};
    const preview = mock((op: { id?: string }) =>
      op.id === "trivy"
        ? new Promise<ApiResult<OperationPayload>>((resolve) => {
            first = resolve;
          })
        : Promise.resolve(payload(`${BEFORE}\nlast:\n`)),
    );
    setup(preview as never);
    await open();
    await userEvent.type(screen.getByLabelText("Job name"), "x");
    await screen.findByText("+last:");
    first(payload(`${BEFORE}\nold:\n`));
    await new Promise((settle) => setTimeout(settle, 20));
    expect(screen.queryByText("+old:")).toBeNull();
  });

  test("une édition coupée coupe le bouton", () => {
    setup(undefined, PIPELINE, true);
    expect(
      (screen.getByRole("button", { name: "Add to pipeline" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
