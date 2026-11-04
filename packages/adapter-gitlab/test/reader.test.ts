import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileReader } from "../src/reader.ts";

let root = "";
let outside = "";

const SECRET = "SECRET-HORS-DEPOT\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-reader-"));
  outside = mkdtempSync(join(tmpdir(), "keelson-dehors-"));
  mkdirSync(join(root, "ci"), { recursive: true });
  writeFileSync(join(root, "ci", "jobs.yml"), "compile:\n  script:\n    - make\n");
  writeFileSync(join(outside, "secret.txt"), SECRET);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("la frontière de la racine", () => {
  test("un fichier de la racine est lu", () => {
    expect(createFileReader(root).read("ci/jobs.yml")).toContain("compile:");
  });

  /** Le défaut trouvé par la revue indépendante du 2026-10-23, et le pire du lot : les deux
   *  contrôles de frontière étaient **lexicaux**, donc aveugles aux liens symboliques. Un dépôt
   *  cloné depuis un tiers suffisait à faire sortir n'importe quel fichier lisible par
   *  l'utilisateur vers la charge envoyée au navigateur, sans le moindre diagnostic. L'extension
   *  `.yml` était par ailleurs contrôlée sur le nom du lien, jamais sur sa cible. */
  test("un lien symbolique qui sort de la racine est refusé", () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "ci", "fuite.yml"));

    const read = createFileReader(root).read("ci/fuite.yml");
    expect(read).toBeNull();
    expect(read).not.toBe(SECRET);
  });

  test("un lien symbolique vers un dossier hors racine est refusé aussi", () => {
    symlinkSync(outside, join(root, "ailleurs"));
    expect(createFileReader(root).read("ailleurs/secret.txt")).toBeNull();
  });

  /** Un lien reste permis s'il reste sous la racine : un dépôt peut légitimement en contenir, et
   *  l'assertion négative seule laisserait passer un lecteur qui refuse tous les liens — ce qui
   *  serait un autre défaut, plus discret. */
  test("un lien symbolique interne à la racine est lu", () => {
    symlinkSync(join(root, "ci", "jobs.yml"), join(root, "ci", "alias.yml"));
    expect(createFileReader(root).read("ci/alias.yml")).toContain("compile:");
  });

  /** Le lien reste dans la racine, mais sa cible n'est pas un YAML : `.git/config` ou `.env`
   *  partiraient vers le navigateur. L'extension se contrôle sur la cible, pas sur le nom du lien. */
  test("un lien interne vers un fichier qui n'est pas du YAML est refusé", () => {
    writeFileSync(join(root, ".env"), "API_KEY=x\n");
    symlinkSync(join(root, ".env"), join(root, "ci", "env.yml"));
    expect(createFileReader(root).read("ci/env.yml")).toBeNull();
  });

  /** Sans `realPrefix`, comparer un chemin réel à la racine écrite refuserait tout. */
  test("une racine atteinte par un lien lit encore ses fichiers", () => {
    const alias = `${root}-alias`;
    symlinkSync(root, alias);
    try {
      expect(createFileReader(alias).read("ci/jobs.yml")).toContain("compile:");
    } finally {
      rmSync(alias);
    }
  });

  test("un chemin lexicalement sorti de la racine est refusé", () => {
    expect(createFileReader(root).read("../dehors.yml")).toBeNull();
    expect(createFileReader(root).read("/etc/passwd")).toBeNull();
  });

  /** Lire une FIFO bloque sans fin, et `detectWorkspace` figeait le démarrage du serveur. */
  test("seul un fichier ordinaire est lu", () => {
    spawnSync("mkfifo", [join(root, "ci", "tube.yml")]);
    expect(createFileReader(root).read("ci/tube.yml")).toBeNull();
  });

  test("un fichier absent rend null plutôt que de lever", () => {
    expect(createFileReader(root).read("ci/absent.yml")).toBeNull();
  });
});
