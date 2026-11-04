import { describe, expect, test } from "bun:test";
import type { IncludeReader } from "../src/includes.ts";
import { GITLAB_CI_FILE, parse } from "../src/parse.ts";

function signals(text: string, files: Record<string, string> = {}, id = "job") {
  const read: IncludeReader = {
    read: (p) => files[p] ?? null,
    candidates: () => Object.keys(files),
  };
  const parsed = parse(text, { file: GITLAB_CI_FILE, read });
  return parsed.pipeline.jobs.find((job) => job.id === id)?.signals;
}

describe("signaux d'un job", () => {
  test("image et script écrits dans le job", () => {
    expect(signals("job:\n  image: aquasec/trivy:0.1\n  script:\n    - trivy fs .\n")).toEqual({
      image: "aquasec/trivy:0.1",
      script: ["trivy fs ."],
    });
  });

  test("image en forme objet", () => {
    expect(signals("job:\n  image:\n    name: x/y\n  script: a\n")?.image).toBe("x/y");
  });

  test("les trois sections, dans l'ordre d'exécution, et un script scalaire", () => {
    expect(
      signals("job:\n  after_script:\n    - c\n  script: b\n  before_script:\n    - a\n")?.script,
    ).toEqual(["a", "b", "c"]);
  });

  test("hérités d'un extends écrit dans un include", () => {
    expect(
      signals("include: ci/t.yml\n\njob:\n  extends: .t\n", {
        "ci/t.yml": ".t:\n  image: semgrep/semgrep\n  script:\n    - semgrep ci\n",
      }),
    ).toEqual({ image: "semgrep/semgrep", script: ["semgrep ci"] });
  });

  test("default s'applique sous le job, et le job le surcharge", () => {
    const text = "default:\n  image: a/b\n  before_script:\n    - x\n\njob:\n  script: y\n";
    expect(signals(text)).toEqual({ image: "a/b", script: ["x", "y"] });
    expect(signals(`${text}  image: c/d\n`)?.image).toBe("c/d");
  });

  test("un !reference dans une liste de script est déplié, et les listes imbriquées aussi", () => {
    expect(
      signals(
        ".s:\n  script:\n    - un\n    - - deux\n\njob:\n  script:\n    - !reference [.s, script]\n    - trois\n",
      )?.script,
    ).toEqual(["un", "deux", "trois"]);
  });

  test("un job sans image ni script rend le vide, pas une erreur", () => {
    expect(signals("job:\n  stage: test\n")).toEqual({ image: null, script: [] });
  });
});
