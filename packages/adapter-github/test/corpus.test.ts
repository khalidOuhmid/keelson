import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/index.ts";

const CORPUS = join(import.meta.dir, "corpus");
const licenses = readFileSync(join(CORPUS, "LICENSES.md"), "utf8");
const checksums = readFileSync(join(CORPUS, "CHECKSUMS.txt"), "utf8");
const files = ["starter-workflows", "edge-cases"].flatMap((group) =>
  readdirSync(join(CORPUS, group))
    .sort()
    .map((name) => ({ group, name })),
);

describe("licence du corpus", () => {
  test("le commit source est épinglé", () => {
    expect(licenses).toContain("e3c451d60f119b71caebf13c98ac45da6e15b4b7");
  });

  test("la notice MIT est reproduite", () => {
    expect(licenses).toContain("Copyright (c) 2020 GitHub");
    expect(licenses).toContain("Permission is hereby granted, free of charge");
    expect(licenses).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  test("chaque fichier officiel est listé avec son SHA-256", () => {
    for (const { name } of files.filter((file) => file.group === "starter-workflows")) {
      expect(licenses).toContain(name);
      const digest = new Bun.CryptoHasher("sha256")
        .update(readFileSync(join(CORPUS, "starter-workflows", name)))
        .digest("hex");
      expect(checksums).toContain(`${digest}  ${name}`);
    }
  });
});

describe("IR golden du corpus", () => {
  test.each(files.map((file) => [`${file.group}/${file.name}`, file] as const))(
    "%s",
    (_id, file) => {
      const text = readFileSync(join(CORPUS, file.group, file.name), "utf8");
      const { pipeline, diagnostics } = parse(text, { file: `.github/workflows/${file.name}` });
      const actual = `${JSON.stringify({ pipeline, diagnostics }, null, 2)}\n`;
      const golden = join(CORPUS, "goldens", `${file.name}.expected.ir.json`);
      if (process.env.KEELSON_UPDATE_GOLDENS === "1") {
        writeFileSync(golden, actual);
      }
      expect(JSON.parse(actual)).toEqual(JSON.parse(readFileSync(golden, "utf8")));
    },
  );
});
