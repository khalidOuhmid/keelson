import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/ui/e2e",
  testMatch: "**/*.e2e.ts",
  reporter: process.env.CI ? "github" : "list",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:5283" },
  webServer: {
    command: "bun run --cwd packages/ui dev",
    url: "http://localhost:5283",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
