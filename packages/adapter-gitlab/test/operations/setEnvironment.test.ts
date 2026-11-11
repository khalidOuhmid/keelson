import { describe, expect, test } from "bun:test";
import { expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const source = [
  "stages:",
  "  - deploy",
  "",
  "string-form:",
  "  stage: deploy",
  "  environment: production",
  "  script:",
  "    - x",
  "",
  "object-form:",
  "  stage: deploy",
  "  environment:",
  "    name: staging",
  "    url: https://staging.example.org",
  "  script:",
  "    - y",
  "",
  "bare:",
  "  stage: deploy",
  "  script:",
  "    - z",
  "",
].join("\n");

describe("setEnvironment", () => {
  test("replaces a string environment with another string", () => {
    const applied = expectOk(source, {
      kind: "setEnvironment",
      id: "string-form",
      environment: { name: "staging" },
    });
    expect(jobOf(applied.text, "string-form").environment?.value).toEqual({ name: "staging" });
    expect(applied.text).toContain("environment: staging");
  });

  test("replaces a string with a block when url or action is provided", () => {
    const applied = expectOk(source, {
      kind: "setEnvironment",
      id: "string-form",
      environment: { name: "production", url: "https://example.org" },
    });
    expect(jobOf(applied.text, "string-form").environment?.value).toEqual({
      name: "production",
      url: "https://example.org",
    });
  });

  test("replaces an existing block", () => {
    const applied = expectOk(source, {
      kind: "setEnvironment",
      id: "object-form",
      environment: { name: "prod", url: "https://prod.example.org", action: "start" },
    });
    expect(jobOf(applied.text, "object-form").environment?.value).toEqual({
      name: "prod",
      url: "https://prod.example.org",
      action: "start",
    });
  });

  test("creates the environment key when the job has none", () => {
    const applied = expectOk(source, {
      kind: "setEnvironment",
      id: "bare",
      environment: { name: "review" },
    });
    expect(jobOf(applied.text, "bare").environment?.value).toEqual({ name: "review" });
  });

  test("removes the environment key when null is passed", () => {
    const applied = expectOk(source, {
      kind: "setEnvironment",
      id: "string-form",
      environment: null,
    });
    expect(jobOf(applied.text, "string-form").environment).toBeNull();
    expect(applied.text).not.toContain("environment: production");
  });

  test("removes a whole environment block when null is passed", () => {
    const applied = expectOk(source, {
      kind: "setEnvironment",
      id: "object-form",
      environment: null,
    });
    expect(jobOf(applied.text, "object-form").environment).toBeNull();
    expect(applied.text).not.toContain("staging.example.org");
  });

  test("writes a local override when the environment is inherited", () => {
    const inherited = [
      ".base:",
      "  environment:",
      "    name: inherited",
      "    url: https://inherited.example.org",
      "",
      "stages:",
      "  - deploy",
      "",
      "worker:",
      "  extends: .base",
      "  stage: deploy",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    const applied = expectOk(inherited, {
      kind: "setEnvironment",
      id: "worker",
      environment: { name: "override" },
    });
    expect(applied.text).toContain(".base:\n  environment:\n    name: inherited");
    expect(jobOf(applied.text, "worker").environment).toEqual({
      value: { name: "override" },
      origin: { kind: "local" },
    });
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(source, {
      kind: "setEnvironment",
      id: "string-form",
      environment: { name: "staging" },
    });
    roundTrip(source, { kind: "setEnvironment", id: "bare", environment: { name: "review" } });
    roundTrip(source, { kind: "setEnvironment", id: "object-form", environment: null });
  });

  test("JOB_NOT_FOUND if the job does not exist", () => {
    expectUnchanged(
      source,
      { kind: "setEnvironment", id: "absent", environment: null },
      "JOB_NOT_FOUND",
    );
  });

  test("INVALID_OPERATION when removing an inherited environment", () => {
    const inherited = [
      ".base:",
      "  environment:",
      "    name: inherited",
      "",
      "stages:",
      "  - deploy",
      "",
      "worker:",
      "  extends: .base",
      "  stage: deploy",
      "  script:",
      "    - x",
      "",
    ].join("\n");
    expectUnchanged(
      inherited,
      { kind: "setEnvironment", id: "worker", environment: null },
      "INVALID_OPERATION",
    );
  });
});
