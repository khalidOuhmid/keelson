import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/ui/e2e",
  testMatch: "**/*.e2e.ts",
  reporter: process.env.CI ? "github" : "list",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
});
