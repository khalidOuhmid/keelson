import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { OpaqueBlockView } from "../../src/panels/OpaqueBlockView.tsx";

afterEach(cleanup);

const SOURCE = ["script:", "  - trivy image --exit-code 1 app", "", "\t- tabbed"].join("\n");

function lines(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".cm-line")];
}

test("a wrapped line hangs under its own content, two columns past its indentation", async () => {
  const { container } = render(<OpaqueBlockView blockKey="script" source={SOURCE} />);
  await waitFor(() => expect(lines(container)).toHaveLength(4));
  const [key, item, blank, tabbed] = lines(container);

  expect(key?.style.paddingLeft).toBe("2ch");
  expect(key?.style.textIndent).toBe("-2ch");
  expect(item?.style.paddingLeft).toBe("4ch");
  expect(item?.style.textIndent).toBe("-4ch");
  expect(blank?.style.paddingLeft).toBe("2ch");
  expect(tabbed?.style.paddingLeft).toBe("6ch");
});
