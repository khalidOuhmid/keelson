import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Tool } from "@keelson/catalog";
import { emptyPipeline, type Job, type Pipeline } from "@keelson/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ApiFailure, ApiResult, OperationPayload } from "../src/api/client.ts";
import { InsertTool, type InsertToolProps } from "../src/views/catalog/InsertTool.tsx";

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

function Harness(props: InsertToolProps) {
  const [open, setOpen] = useState(false);
  return <InsertTool {...props} open={open} onOpen={setOpen} />;
}

function setup(preview = mock(async () => payload()), pipeline = PIPELINE, disabled = false) {
  const onInsert = mock(async () => null);
  render(
    <Harness
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

describe("insertion from the catalogue entry", () => {
  test("nothing is sent before opening", () => {
    const { preview } = setup();
    expect(preview).not.toHaveBeenCalled();
  });

  async function open() {
    await userEvent.click(screen.getByRole("button", { name: "Add to pipeline" }));
  }

  test("the diff and the covered layer show before any write", async () => {
    const { onInsert } = setup();
    await open();
    await screen.findByText("trivy:");
    expect(screen.getByTestId("insert-diff").textContent).toContain("+trivy:");
    expect(screen.getByTestId("insert-layers").textContent).toContain("SCA");
    expect(onInsert).not.toHaveBeenCalled();
  });

  test("the snippet's stage is reused, the name is free", async () => {
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

  test("a taken name gets a suffix", async () => {
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

  test("a missing stage is announced, and the operation becomes composite", async () => {
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

  test("inserting sends the same operation", async () => {
    const { onInsert } = setup();
    await open();
    await screen.findByText("trivy:");
    await userEvent.click(screen.getByRole("button", { name: "Insert into .gitlab-ci.yml" }));
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "addSnippet", id: "trivy" }),
      "trivy",
    );
  });

  test("a rejection is stated plainly and disables Insert", async () => {
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
    expect(
      (screen.getByRole("button", { name: "Insert into .gitlab-ci.yml" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("a response for an old name does not replace the latest", async () => {
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
    await screen.findByText("last:");
    first(payload(`${BEFORE}\nold:\n`));
    await new Promise((settle) => setTimeout(settle, 20));
    expect(screen.queryByText("old:")).toBeNull();
  });

  test("focus moves into the form on open", async () => {
    setup();
    await open();
    expect(document.activeElement).toBe(screen.getByLabelText("Job name"));
  });

  test("Cancel closes without writing anything", async () => {
    const { onInsert } = setup();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add to pipeline" })).toBeDefined();
    expect(onInsert).not.toHaveBeenCalled();
  });

  test("Enter inserts", async () => {
    const { onInsert } = setup();
    await open();
    await screen.findByText("trivy:");
    await userEvent.type(screen.getByLabelText("Job name"), "{Enter}");
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  test("a stale diff disables Insert until the next response", async () => {
    const preview = mock((op: { id?: string }) =>
      op.id === "trivy" ? Promise.resolve(payload()) : new Promise<never>(() => {}),
    );
    setup(preview as never);
    await open();
    await screen.findByText("trivy:");
    await userEvent.type(screen.getByLabelText("Job name"), "x");
    const insert = screen.getByRole("button", { name: "Insert into .gitlab-ci.yml" });
    expect((insert as HTMLButtonElement).disabled).toBe(true);
  });

  test("a rejected write is reported in the form", async () => {
    const onInsert = mock(async () => ({
      status: 0,
      code: "NETWORK_ERROR" as const,
      params: { detail: "cut off" },
    }));
    render(
      <Harness
        tool={TOOL}
        pipeline={PIPELINE}
        text={BEFORE}
        disabled={false}
        preview={async () => payload()}
        onInsert={onInsert}
      />,
    );
    await open();
    await screen.findByText("trivy:");
    await userEvent.click(screen.getByRole("button", { name: "Insert into .gitlab-ci.yml" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cut off");
  });

  test("the document changes during a rejected write: the preview resumes", async () => {
    const preview = mock(async () => payload());
    let refuse: (failure: ApiFailure) => void = () => {};
    const onInsert = mock(
      () =>
        new Promise<ApiFailure>((resolve) => {
          refuse = resolve;
        }),
    );
    const props = { tool: TOOL, disabled: false, preview, onInsert };
    const { rerender } = render(<Harness {...props} pipeline={PIPELINE} text={BEFORE} />);
    await open();
    await screen.findByText("trivy:");
    await userEvent.click(screen.getByRole("button", { name: "Insert into .gitlab-ci.yml" }));
    rerender(<Harness {...props} pipeline={{ ...PIPELINE }} text={`${BEFORE}# x\n`} />);
    await new Promise((settle) => setTimeout(settle, 10));
    preview.mockClear();
    refuse({ status: 409, code: "NETWORK_ERROR", params: { detail: "cut off" } });
    await waitFor(() => expect(preview).toHaveBeenCalled());
  });

  test("the diff is semantic: ins, del, and the meaning spelled out", async () => {
    setup(mock(async () => payload("stages:\n  - deploy\n")));
    await open();
    await screen.findByText("Changes to .gitlab-ci.yml");
    const figure = document.querySelector("figure");
    expect(figure?.querySelector("ins")?.textContent).toContain("added");
    expect(figure?.querySelector("del")?.textContent).toContain("removed");
  });

  test("disabled editing disables the button", () => {
    setup(undefined, PIPELINE, true);
    expect(
      (screen.getByRole("button", { name: "Add to pipeline" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
