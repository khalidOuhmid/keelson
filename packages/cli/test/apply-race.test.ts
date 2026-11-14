import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverRoot = join(packageRoot, "..", "server");
const binary = join(packageRoot, "dist", "keelson.js");
const FILE = ".gitlab-ci.yml";
const CI = "stages:\n  - build\n\nbuild:\n  stage: build\n  script:\n    - make\n";

const created: string[] = [];

beforeAll(() => {
  for (const cwd of [serverRoot, packageRoot]) {
    const build = spawnSync("bun", ["run", "build"], { cwd, encoding: "utf8" });
    if (build.status !== 0) {
      throw new Error(`build failed in ${cwd}: ${build.stderr}`);
    }
  }
});

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), `keelson-race-${prefix}-`));
  created.push(directory);
  return directory;
}

/** `keelson start`'s store, in its own Node process, paused inside its write until told to go. */
function serverWriter(root: string): ChildProcess {
  const script = join(temporary("script"), "server-writer.mjs");
  writeFileSync(
    script,
    `import { DocumentStore, detectWorkspace, writeAtomic } from ${JSON.stringify(
      pathToFileURL(join(serverRoot, "dist", "index.js")).href,
    )};
const root = process.argv[2];
const go = new Promise((settle) => process.stdin.once("data", settle));
const store = new DocumentStore(root, detectWorkspace(root), async (path, text) => {
  process.stdout.write("writing\\n");
  await go;
  await writeAtomic(path, text);
});
await store.load(${JSON.stringify(FILE)});
const response = await store.applyOperation(
  ${JSON.stringify(FILE)},
  { v: 1, baseHash: store.currentHash(${JSON.stringify(FILE)}), kind: "addStage", name: "from-start" },
  "op-start",
);
process.stdout.write(JSON.stringify({ status: response.status }) + "\\n");
process.exit(0);
`,
  );
  return spawn("node", [script, root], { stdio: ["pipe", "pipe", "inherit"] });
}

function output(child: ChildProcess): {
  text: () => string;
  line: (match: string) => Promise<void>;
} {
  let text = "";
  const waiting: { match: string; settle: () => void }[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    text += chunk.toString("utf8");
    for (const entry of waiting.filter((candidate) => text.includes(candidate.match))) {
      entry.settle();
    }
  });
  return {
    text: () => text,
    line: (match) =>
      new Promise((settle) => {
        if (text.includes(match)) {
          settle();
        } else {
          waiting.push({ match, settle });
        }
      }),
  };
}

const exited = (child: ChildProcess) =>
  new Promise<number | null>((settle) => {
    if (child.exitCode !== null) {
      settle(child.exitCode);
    } else {
      child.once("exit", (code) => settle(code));
    }
  });

describe("keelson apply racing keelson start on one file, in two processes", () => {
  test("the later writer gets STALE_DOCUMENT and never overwrites", async () => {
    const root = temporary("repo");
    writeFileSync(join(root, FILE), CI);
    const operations = join(temporary("ops"), "ops.json");
    writeFileSync(operations, JSON.stringify({ v: 1, kind: "addStage", name: "from-apply" }));

    const server = serverWriter(root);
    const serverOutput = output(server);
    await serverOutput.line("writing");

    const apply = spawn("node", [binary, "apply", operations, root, "--rebase", "--json"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const applyOutput = output(apply);
    const applyExit = exited(apply);
    const raced = await Promise.race([
      applyExit.then(() => "apply finished first"),
      new Promise((settle) => setTimeout(() => settle("apply waited"), 600)),
    ]);

    server.stdin?.write("go\n");
    const [serverCode, applyCode] = await Promise.all([exited(server), applyExit]);

    expect(raced).toBe("apply waited");
    expect(serverCode).toBe(0);
    expect(serverOutput.text()).toContain('{"status":200}');
    expect(applyCode).toBe(1);
    expect(JSON.parse(applyOutput.text()).results[0].error.code).toBe("STALE_DOCUMENT");
    const final = readFileSync(join(root, FILE), "utf8");
    expect(final).toContain("from-start");
    expect(final).not.toContain("from-apply");
    expect(readdirSync(root)).toEqual([FILE]);
  }, 20_000);
});
