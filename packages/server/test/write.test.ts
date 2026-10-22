import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../src/write.ts";

let workspace = "";

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "keelson-write-"));
});

afterEach(() => {
  // laissé en place volontairement : les dossiers temporaires sont nettoyés par l'OS
});

describe("writeAtomic", () => {
  test("écrit le contenu demandé", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "avant\n");
    await writeAtomic(path, "après\n");
    expect(readFileSync(path, "utf8")).toBe("après\n");
  });

  test("crée le fichier s'il n'existe pas", async () => {
    const path = join(workspace, "neuf.yml");
    await writeAtomic(path, "contenu\n");
    expect(readFileSync(path, "utf8")).toBe("contenu\n");
  });

  test("ne laisse aucun fichier temporaire derrière elle", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "avant\n");
    await writeAtomic(path, "après\n");
    expect(readdirSync(workspace)).toEqual(["a.yml"]);
  });

  test("conserve le mode du fichier d'origine", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "avant\n");
    chmodSync(path, 0o640);
    await writeAtomic(path, "après\n");
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  test("conserve un mode exécutable", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "avant\n");
    chmodSync(path, 0o755);
    await writeAtomic(path, "après\n");
    expect(statSync(path).mode & 0o777).toBe(0o755);
  });

  test("écrit les octets UTF-8 sans BOM ni réécriture des fins de ligne", async () => {
    const path = join(workspace, "crlf.yml");
    await writeAtomic(path, "a:\r\n  b: é\r\n");
    expect(readFileSync(path).toString("utf8")).toBe("a:\r\n  b: é\r\n");
  });

  test("laisse le fichier d'origine intact si le dossier n'est pas accessible en écriture", async () => {
    const protege = mkdtempSync(join(tmpdir(), "keelson-write-ro-"));
    const path = join(protege, "a.yml");
    writeFileSync(path, "intact\n");
    chmodSync(protege, 0o500);

    await expect(writeAtomic(path, "nouveau\n")).rejects.toThrow();

    chmodSync(protege, 0o700);
    expect(readFileSync(path, "utf8")).toBe("intact\n");
    expect(readdirSync(protege)).toEqual(["a.yml"]);
  });

  test("le fichier temporaire est créé dans le même dossier que la cible", async () => {
    const path = join(workspace, "a.yml");
    writeFileSync(path, "avant\n");
    const seen: string[][] = [];
    const original = readdirSync(workspace);
    await writeAtomic(path, "x".repeat(200_000));
    seen.push(original, readdirSync(workspace));
    expect(seen[1]).toEqual(["a.yml"]);
    expect(readFileSync(path, "utf8")).toHaveLength(200_000);
  });

  test("deux écritures successives aboutissent au dernier contenu", async () => {
    const path = join(workspace, "a.yml");
    await writeAtomic(path, "un\n");
    await writeAtomic(path, "deux\n");
    expect(readFileSync(path, "utf8")).toBe("deux\n");
  });
});
