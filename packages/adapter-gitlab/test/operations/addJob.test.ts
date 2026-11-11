import { describe, expect, test } from "bun:test";
import { BASE, expectOk, expectUnchanged, jobOf, roundTrip } from "../support/apply.ts";

const minimal = {
  kind: "addJob" as const,
  job: { id: "paquet", stage: "deploy", script: ["make package"] },
};

describe("addJob", () => {
  test("inserts the job at the end of the file after an empty line", () => {
    const applied = expectOk(BASE, minimal);
    expect(applied.text).toStartWith(BASE);
    expect(applied.text.slice(BASE.length)).toBe(
      "\npaquet:\n  stage: deploy\n  script:\n    - make package\n",
    );
  });

  test("the inserted job is present in the returned IR", () => {
    const applied = expectOk(BASE, minimal);
    const added = applied.pipeline.jobs.find((job) => job.id === "paquet");
    expect(added?.stage.value).toBe("deploy");
    expect(added?.stage.origin).toEqual({ kind: "local" });
  });

  test("returns YAML that reparses without error", () => {
    const applied = expectOk(BASE, minimal);
    expect(applied.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("writes the requested needs", () => {
    const applied = expectOk(BASE, {
      kind: "addJob",
      job: { id: "paquet", stage: "deploy", script: ["x"], needs: [{ job: "compile" }] },
    });
    expect(jobOf(applied.text, "paquet").needs?.value).toEqual([
      { job: "compile", optional: false, artifacts: true },
    ]);
  });

  test("writes a need in object form when it carries options", () => {
    const applied = expectOk(BASE, {
      kind: "addJob",
      job: {
        id: "paquet",
        stage: "deploy",
        script: ["x"],
        needs: [{ job: "compile", optional: true, artifacts: false }],
      },
    });
    expect(jobOf(applied.text, "paquet").needs?.value).toEqual([
      { job: "compile", optional: true, artifacts: false },
    ]);
  });

  test("writes the requested environment", () => {
    const applied = expectOk(BASE, {
      kind: "addJob",
      job: {
        id: "livre",
        stage: "deploy",
        script: ["x"],
        environment: { name: "production", url: "https://exemple.org" },
      },
    });
    expect(jobOf(applied.text, "livre").environment?.value).toEqual({
      name: "production",
      url: "https://exemple.org",
    });
  });

  test("follows the file's detected indentation", () => {
    const quatre = BASE.replaceAll("\n  ", "\n    ").replaceAll("\n      - ", "\n        - ");
    const applied = expectOk(quatre, minimal);
    expect(applied.text.slice(quatre.length)).toContain("\n    stage: deploy");
  });

  test("adds a line break if the file has none at the end", () => {
    const sansEol = BASE.trimEnd();
    const applied = expectOk(sansEol, minimal);
    expect(applied.text).toContain("\n\npaquet:\n");
    expect(jobOf(applied.text, "paquet").id).toBe("paquet");
  });

  test("preserves CRLF line endings", () => {
    const crlf = BASE.replaceAll("\n", "\r\n");
    const applied = expectOk(crlf, minimal);
    expect(applied.text.slice(crlf.length)).not.toContain("\n\n");
    expect(applied.text.slice(crlf.length)).toContain("\r\n");
  });

  test("the inverse restores the original bytes", () => {
    roundTrip(BASE, minimal);
    roundTrip(BASE.trimEnd(), minimal);
  });

  test("touched covers only the added text", () => {
    const applied = expectOk(BASE, minimal);
    expect(applied.touched).toHaveLength(1);
    expect(applied.text.slice(0, applied.touched[0]?.start)).toBe(BASE);
  });

  test("NAME_CONFLICT if the job already exists", () => {
    expectUnchanged(
      BASE,
      {
        kind: "addJob",
        job: { id: "compile", stage: "build", script: ["x"] },
      },
      "NAME_CONFLICT",
    );
  });

  test("NAME_CONFLICT if a template has this name", () => {
    const avecTemplate = `.base:\n  image: node\n\n${BASE}`;
    expectUnchanged(
      avecTemplate,
      {
        kind: "addJob",
        job: { id: ".base", stage: "build", script: ["x"] },
      },
      "INVALID_NAME",
    );
  });

  test("INVALID_NAME if the name is empty", () => {
    expectUnchanged(
      BASE,
      { kind: "addJob", job: { id: "", stage: "build", script: ["x"] } },
      "INVALID_NAME",
    );
  });

  test("INVALID_NAME if the name starts with a dot", () => {
    expectUnchanged(
      BASE,
      { kind: "addJob", job: { id: ".cache", stage: "build", script: ["x"] } },
      "INVALID_NAME",
    );
  });

  test("INVALID_NAME for each reserved word", () => {
    for (const reserved of [
      "stages",
      "variables",
      "include",
      "default",
      "workflow",
      "image",
      "services",
      "cache",
      "before_script",
      "after_script",
    ]) {
      expectUnchanged(
        BASE,
        {
          kind: "addJob",
          job: { id: reserved, stage: "build", script: ["x"] },
        },
        "INVALID_NAME",
      );
    }
  });

  test("STAGE_NOT_FOUND if the stage is not declared", () => {
    expectUnchanged(
      BASE,
      {
        kind: "addJob",
        job: { id: "paquet", stage: "inconnu", script: ["x"] },
      },
      "STAGE_NOT_FOUND",
    );
  });

  test("INVALID_OPERATION if the script is empty", () => {
    expectUnchanged(
      BASE,
      { kind: "addJob", job: { id: "paquet", stage: "build", script: [] } },
      "INVALID_OPERATION",
    );
  });
});
