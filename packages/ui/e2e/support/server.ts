import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const uiDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repoRoot = dirname(dirname(uiDir));

export const BINARY = join(repoRoot, "packages", "cli", "dist", "keelson.js");
export const FIXTURE = join(uiDir, "dev-fixture", ".gitlab-ci.yml");

export type Running = {
  url: string;
  origin: string;
  token: string;
  dir: string;
  file: string;
  read: () => string;
  write: (text: string) => void;
  stop: () => Promise<void>;
};

export async function startKeelson(): Promise<Running> {
  const dir = mkdtempSync(join(tmpdir(), "keelson-e2e-"));
  const file = join(dir, ".gitlab-ci.yml");
  copyFileSync(FIXTURE, file);

  const child: ChildProcess = spawn("node", [BINARY, "start", "--no-open", "--port", "0"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`pas d'URL après 20 s ; sortie : ${output}`)),
      20_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64})/.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`le binaire est sorti en ${code} ; sortie : ${output}`));
    });
  });

  const parsed = new URL(url);

  return {
    url,
    origin: parsed.origin,
    token: parsed.searchParams.get("token") ?? "",
    dir,
    file,
    read: () => readFileSync(file, "utf8"),
    write: (text) => writeFileSync(file, text),
    async stop() {
      child.kill("SIGINT");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(resolve, 3_000);
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
