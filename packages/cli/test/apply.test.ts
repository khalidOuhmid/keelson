import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "@keelson/core";
import { run } from "../src/run.ts";

const BASE = [
  "stages:",
  "  - build",
  "  - test",
  "",
  "compile:",
  "  stage: build",
  "  script:",
  "    - make",
  "",
].join("\n");

const OTHER = [
  "# un autre dépôt, un autre texte",
  "stages:",
  "  - build",
  "  - test",
  "",
  "lint:",
  "  stage: test",
  "  script:",
  "    - npm run lint",
  "",
].join("\n");

const created: string[] = [];

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), `keelson-apply-${prefix}-`));
  created.push(directory);
  return directory;
}

function repository(text: string | null, file = ".gitlab-ci.yml"): string {
  const root = temporary("repo");
  if (text !== null) {
    writeFileSync(join(root, file), text);
  }
  return root;
}

function opsFile(content: unknown): string {
  const path = join(temporary("ops"), "ops.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function addStage(text: string, name: string) {
  return { v: 1, baseHash: hashText(text), kind: "addStage", name };
}

function addJob(text: string, id: string, stage: string) {
  return {
    v: 1,
    baseHash: hashText(text),
    kind: "addJob",
    job: { id, stage, script: [`./${id}`] },
  };
}

const ZERO_HASH = "0".repeat(64);

function read(root: string, file = ".gitlab-ci.yml"): string {
  return readFileSync(join(root, file), "utf8");
}

const WITH_DEPLOY = BASE.replace("  - test\n", "  - test\n  - deploy\n");

describe("une opération seule", () => {
  test("écrit le fichier et sort en 0", async () => {
    const root = repository(BASE);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), root]);

    expect(result.exitCode).toBe(0);
    expect(read(root)).toBe(WITH_DEPLOY);
    expect(result.stdout).toBe(`✓ ${root}  1 operation(s) applied\n`);
    expect(result.stderr).toBe("");
  });

  test("vise le dossier courant quand aucun dépôt n'est donné", async () => {
    const root = repository(BASE);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy"))], { cwd: root });

    expect(result.exitCode).toBe(0);
    expect(read(root)).toBe(WITH_DEPLOY);
    expect(result.stdout).toBe("✓ .  1 operation(s) applied\n");
  });

  test("un chemin d'opérations relatif est lu depuis le dossier courant", async () => {
    const root = repository(BASE);
    writeFileSync(join(root, "ops.json"), JSON.stringify(addStage(BASE, "deploy")));
    const result = await run(["apply", "ops.json"], { cwd: root });

    expect(result.exitCode).toBe(0);
    expect(read(root)).toBe(WITH_DEPLOY);
  });

  test("ne laisse aucun fichier temporaire derrière l'écriture", async () => {
    const root = repository(BASE);
    await run(["apply", opsFile(addStage(BASE, "deploy")), root]);
    expect(readdirSync(root).sort()).toEqual([".gitlab-ci.yml"]);
  });
});

describe("une séquence", () => {
  test("un tableau s'applique dans l'ordre, chaque hash ancré sur le texte précédent", async () => {
    const root = repository(BASE);
    const ops = [addStage(BASE, "deploy"), addJob(WITH_DEPLOY, "ship", "deploy")];
    const result = await run(["apply", opsFile(ops), root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`✓ ${root}  2 operation(s) applied\n`);
    expect(read(root)).toBe(`${WITH_DEPLOY}\nship:\n  stage: deploy\n  script:\n    - ./ship\n`);
  });

  test("une seconde opération ancrée sur le texte d'origine est périmée sans --rebase", async () => {
    const root = repository(BASE);
    const ops = [addStage(BASE, "deploy"), addJob(BASE, "ship", "deploy")];
    const result = await run(["apply", opsFile(ops), root]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      `✗ ${root}  operations[1] (addJob): the document changed since the operation was computed\n`,
    );
  });

  test("tout ou rien : l'échec d'une étape n'écrit pas les précédentes", async () => {
    const root = repository(BASE);
    const ops = [
      addStage(BASE, "deploy"),
      { v: 1, baseHash: hashText(WITH_DEPLOY), kind: "removeJob", id: "absent" },
    ];
    const result = await run(["apply", opsFile(ops), root]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      `✗ ${root}  operations[1] (removeJob): job "absent" does not exist in this file\n`,
    );
    expect(read(root)).toBe(BASE);
  });
});

describe("--rebase et la flotte", () => {
  test("un même fichier d'opérations s'applique à deux dépôts de contenus différents", async () => {
    const first = repository(BASE);
    const second = repository(OTHER);
    const ops = [
      { v: 1, baseHash: ZERO_HASH, kind: "addStage", name: "deploy" },
      {
        v: 1,
        baseHash: ZERO_HASH,
        kind: "addJob",
        job: { id: "ship", stage: "deploy", script: ["./ship"] },
      },
    ];
    const result = await run(["apply", opsFile(ops), first, second, "--rebase"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `✓ ${first}  2 operation(s) applied\n✓ ${second}  2 operation(s) applied\n`,
    );
    for (const root of [first, second]) {
      expect(read(root)).toContain("  - deploy\n");
      expect(read(root)).toContain("ship:\n  stage: deploy\n");
    }
    expect(read(second)).toContain("lint:\n  stage: test\n");
  });

  test("sans --rebase, le dépôt dont le texte diffère est périmé et les autres sont écrits", async () => {
    const first = repository(BASE);
    const second = repository(OTHER);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), first, second]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      [
        `✓ ${first}  1 operation(s) applied`,
        `✗ ${second}  operations[0] (addStage): the document changed since the operation was computed`,
        "",
      ].join("\n"),
    );
    expect(read(first)).toBe(WITH_DEPLOY);
    expect(read(second)).toBe(OTHER);
  });

  test("un dépôt en échec n'arrête pas les suivants", async () => {
    const missing = repository(null);
    const ok = repository(BASE);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), missing, ok]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      `✗ ${missing}  file not found: .gitlab-ci.yml\n✓ ${ok}  1 operation(s) applied\n`,
    );
    expect(read(ok)).toBe(WITH_DEPLOY);
  });

  test("un dépôt qui n'est pas un dossier échoue seul", async () => {
    const ghost = join(temporary("ghost"), "absent");
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), ghost]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`✗ ${ghost}  not a directory\n`);
  });
});

describe("--dry-run", () => {
  test("n'écrit rien et rend le diff, le compte de lignes et le nouveau hash", async () => {
    const root = repository(BASE);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), root, "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(read(root)).toBe(BASE);
    expect(readdirSync(root)).toEqual([".gitlab-ci.yml"]);
    expect(result.stdout).toBe(
      [
        `✓ ${root}  1 operation(s) applied (dry run, nothing written)`,
        `  +1 -0 line(s), new hash ${hashText(WITH_DEPLOY)}`,
        `--- ${root}/.gitlab-ci.yml`,
        `+++ ${root}/.gitlab-ci.yml`,
        "@@ -3,0 +4,1 @@",
        "+  - deploy",
        "",
      ].join("\n"),
    );
  });

  test("deux changements éloignés rendent deux blocs, numérotés sur chaque côté", async () => {
    const root = repository(BASE);
    const ops = [addStage(BASE, "deploy"), addJob(WITH_DEPLOY, "ship", "deploy")];
    const result = await run(["apply", opsFile(ops), root, "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("  +6 -0 line(s)");
    expect(result.stdout).toContain(
      [
        "@@ -3,0 +4,1 @@",
        "+  - deploy",
        "@@ -8,0 +10,5 @@",
        "+",
        "+ship:",
        "+  stage: deploy",
        "+  script:",
        "+    - ./ship",
        "",
      ].join("\n"),
    );
    expect(read(root)).toBe(BASE);
  });

  test("un remplacement rend ses lignes retirées puis ajoutées", async () => {
    const root = repository(BASE);
    const ops = [
      { v: 1, baseHash: hashText(BASE), kind: "renameJob", from: "compile", to: "build-all" },
    ];
    const result = await run(["apply", opsFile(ops), root, "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("  +1 -1 line(s)");
    expect(result.stdout).toContain("@@ -5,1 +5,1 @@\n-compile:\n+build-all:\n");
  });

  test("un échec reste un échec en dry-run", async () => {
    const root = repository(OTHER);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), root, "--dry-run"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      `✗ ${root}  operations[0] (addStage): the document changed since the operation was computed\n`,
    );
  });
});

describe("--json", () => {
  test("rend un résultat par dépôt, avec hash en succès et erreur structurée en échec", async () => {
    const first = repository(BASE);
    const second = repository(OTHER);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), first, second, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      results: [
        {
          repo: first,
          ok: true,
          applied: 1,
          written: true,
          hash: hashText(WITH_DEPLOY),
        },
        {
          repo: second,
          ok: false,
          applied: 0,
          written: false,
          error: {
            operation: 0,
            kind: "addStage",
            code: "STALE_DOCUMENT",
            params: { expected: hashText(OTHER), received: hashText(BASE) },
            message: "the document changed since the operation was computed",
          },
        },
      ],
    });
  });

  test("une erreur de dépôt n'a que son message", async () => {
    const missing = repository(null);
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), missing, "--json"]);
    expect(JSON.parse(result.stdout)).toEqual({
      results: [
        {
          repo: missing,
          ok: false,
          applied: 0,
          written: false,
          error: { message: "file not found: .gitlab-ci.yml" },
        },
      ],
    });
  });

  test("avec --dry-run, written vaut false et le fichier reste intact", async () => {
    const root = repository(BASE);
    const result = await run([
      "apply",
      opsFile(addStage(BASE, "deploy")),
      root,
      "--json",
      "--dry-run",
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      results: [{ repo: root, ok: true, applied: 1, written: false, hash: hashText(WITH_DEPLOY) }],
    });
    expect(read(root)).toBe(BASE);
  });
});

describe("--file", () => {
  test("vise un autre fichier, relatif à la racine de chaque dépôt", async () => {
    const root = repository(BASE, "ci.yml");
    const result = await run([
      "apply",
      opsFile(addStage(BASE, "deploy")),
      root,
      "--file",
      "ci.yml",
    ]);
    expect(result.exitCode).toBe(0);
    expect(read(root, "ci.yml")).toBe(WITH_DEPLOY);
  });

  test("un chemin qui sort de la racine est refusé sans lecture ni écriture", async () => {
    const outside = repository(BASE);
    const root = repository(BASE);
    const result = await run([
      "apply",
      opsFile(addStage(BASE, "deploy")),
      root,
      "--file",
      `../${outside.split("/").at(-1)}/.gitlab-ci.yml`,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("is outside the repository");
    expect(read(outside)).toBe(BASE);
  });

  test("un lien vers un fichier hors de la racine est refusé", async () => {
    const outside = repository(BASE);
    const root = repository(null);
    symlinkSync(join(outside, ".gitlab-ci.yml"), join(root, ".gitlab-ci.yml"));
    const result = await run(["apply", opsFile(addStage(BASE, "deploy")), root]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`✗ ${root}  .gitlab-ci.yml is outside the repository\n`);
    expect(read(outside)).toBe(BASE);
  });

  test("les include locaux sont lus dans la racine du dépôt", async () => {
    const root = repository(["include: /ci/jobs.yml", "", BASE].join("\n"));
    mkdirSync(join(root, "ci"));
    writeFileSync(join(root, "ci", "jobs.yml"), "unit:\n  stage: test\n  script:\n    - t\n");
    const text = read(root);
    const ops = { v: 1, baseHash: hashText(text), kind: "removeJob", id: "unit" };
    const result = await run(["apply", opsFile(ops), root]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("operations[0] (removeJob):");
    expect(result.stdout).not.toContain("does not exist");
  });
});

describe("usage", () => {
  test("sans fichier d'opérations, sort en 2", async () => {
    const result = await run(["apply"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("keelson apply: expected an operations file");
  });

  test("un fichier d'opérations introuvable sort en 2", async () => {
    const result = await run(["apply", "/chemin/absent/ops.json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("keelson apply: file not found: /chemin/absent/ops.json\n");
  });

  test("un JSON illisible sort en 2 sans toucher aux dépôts", async () => {
    const root = repository(BASE);
    const result = await run(["apply", opsFile("{ pas du json"), root]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("is not valid JSON");
    expect(result.stdout).toBe("");
    expect(read(root)).toBe(BASE);
  });

  test("un tableau vide sort en 2", async () => {
    const result = await run(["apply", opsFile([]), repository(BASE)]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("keelson apply: the operations file contains no operation\n");
  });

  test("une opération invalide sort en 2 en nommant son index, avant tout dépôt", async () => {
    const root = repository(BASE);
    const ops = [addStage(BASE, "deploy"), { v: 1, baseHash: hashText(BASE), kind: "fly" }];
    const result = await run(["apply", opsFile(ops), root]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toStartWith("keelson apply: operations[1]: ");
    expect(result.stdout).toBe("");
    expect(read(root)).toBe(BASE);
  });

  test("une version inconnue est rendue par le registre de messages", async () => {
    const result = await run(["apply", opsFile({ ...addStage(BASE, "x"), v: 2 })]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(
      "keelson apply: operation: operation version 2 is not supported, expected 1\n",
    );
  });

  test("une option inconnue sort en 2", async () => {
    const result = await run(["apply", opsFile(addStage(BASE, "x")), "--force"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--force");
  });

  test("rien n'est créé quand le fichier visé manque", async () => {
    const root = repository(null);
    await run(["apply", opsFile(addStage(BASE, "deploy")), root]);
    expect(existsSync(join(root, ".gitlab-ci.yml"))).toBe(false);
  });
});

describe("aide", () => {
  test("apply apparaît dans l'aide générale", async () => {
    expect((await run(["--help"])).stdout).toContain("apply ");
  });
});
