import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "../src/app.tsx";

afterEach(cleanup);

test("App rend le titre « Keelson »", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Keelson");
});
