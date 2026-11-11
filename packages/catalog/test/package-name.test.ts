import { expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { PACKAGE_NAME } from "../src/index.ts";

test("PACKAGE_NAME matches the name in package.json", () => {
  expect(PACKAGE_NAME).toBe(packageJson.name);
});
