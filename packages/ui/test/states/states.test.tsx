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

const MAIN = ".gitlab-ci.yml";

function error(detail = "broken"): Diagnostic {
  return {
    code: "INVALID_YAML",
    severity: "error",
    params: { detail },
    range: { start: 0, end: 4 },
    file: MAIN,
  };
}

describe("Loading", () => {
  test("announces loading to a screen reader", () => {
    render(<Loading />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/loading/i);
  });

  test("the status is polite, so as not to interrupt current reading", () => {
    render(<Loading />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});

describe("NoCiFile", () => {
  test("says that no CI file was detected", () => {
    render(<NoCiFile root="/depot" />);
    expect(screen.getByRole("heading", { name: /no ci file/i })).toBeDefined();
  });

  test("names the inspected folder, so the user knows where Keelson looked", () => {
    render(<NoCiFile root="/depot/mon-projet" />);
    expect(screen.getByText(/\/depot\/mon-projet/)).toBeDefined();
  });

  test("names the expected file", () => {
    render(<NoCiFile root="/depot" />);
    expect(screen.getByText(/\.gitlab-ci\.yml/)).toBeDefined();
  });

  test("offers no editing action", () => {
    render(<NoCiFile root="/depot" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("InvalidDocument", () => {
  test("says that the file is invalid and editing is disabled", () => {
    render(<InvalidDocument diagnostics={[error()]} />);
    expect(screen.getByRole("heading", { name: /cannot be parsed/i })).toBeDefined();
    expect(screen.getByText(/editing is disabled/i)).toBeDefined();
  });

  test("shows the blocking diagnostics", () => {
    render(<InvalidDocument diagnostics={[error("inconsistent indentation")]} />);
    expect(screen.getByText(/inconsistent indentation/)).toBeDefined();
  });

  test("shows only error diagnostics", () => {
    render(
      <InvalidDocument
        diagnostics={[
          error("blocking"),
          {
            code: "JOB_WITHOUT_SCRIPT",
            severity: "warning",
            params: { job: "muet" },
            range: null,
            file: MAIN,
          },
        ]}
      />,
    );
    expect(screen.getByText(/blocking/)).toBeDefined();
    expect(screen.queryByText(/muet/)).toBeNull();
  });

  test("says that the file stays intact on disk", () => {
    render(<InvalidDocument diagnostics={[error()]} />);
    expect(screen.getByText(/untouched/i)).toBeDefined();
  });

  test("the block is an alert for a screen reader", () => {
    render(<InvalidDocument diagnostics={[error()]} />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});

describe("DocumentRemoved", () => {
  test("says that the file was deleted on disk", () => {
    render(<DocumentRemoved file=".gitlab-ci.yml" />);
    expect(screen.getByRole("heading", { name: /deleted/i })).toBeDefined();
  });

  test("names the missing file", () => {
    render(<DocumentRemoved file="ci/pipeline.yml" />);
    expect(screen.getByText(/ci\/pipeline\.yml/)).toBeDefined();
  });

  test("says that Keelson will resume if the file comes back", () => {
    render(<DocumentRemoved file=".gitlab-ci.yml" />);
    expect(screen.getByText(/reappears/i)).toBeDefined();
  });

  test("the block is an alert", () => {
    render(<DocumentRemoved file=".gitlab-ci.yml" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});

describe("NoticeBar", () => {
  function notice(kind: Notice["kind"], message = "quelque chose a changé"): Notice {
    return { kind, message } as Notice;
  }

  test("shows nothing without a notice", () => {
    const { container } = render(<NoticeBar notice={null} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });

  test("shows the notice message", () => {
    render(
      <NoticeBar notice={notice("reloaded", "rechargé depuis le disque")} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/rechargé depuis le disque/)).toBeDefined();
  });

  test("a stale notice is an alert: it carries a consequence", () => {
    render(<NoticeBar notice={notice("stale")} onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("a reloaded notice is a polite status: it is informative", () => {
    render(<NoticeBar notice={notice("reloaded")} onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  test("each variant is named in text, not only by colour", () => {
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

  test("the notice can be dismissed", async () => {
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

  test("the close button is reachable from the keyboard", () => {
    render(<NoticeBar notice={notice("stale")} onDismiss={() => {}} />);
    expect(screen.getByRole("button", { name: /dismiss/i }).getAttribute("tabindex")).not.toBe(
      "-1",
    );
  });
});
