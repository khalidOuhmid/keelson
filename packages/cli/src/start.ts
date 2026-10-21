import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type KeelsonServer, type ServerOptions } from "@keelson/server";
import { parseCommandArgs } from "./args.ts";
import type { CliResult } from "./result.ts";

export type StartDeps = {
  open?: (url: string) => void;
  write?: (chunk: string) => void;
  waitForShutdown?: () => Promise<void>;
  serve?: (options: ServerOptions) => Promise<KeelsonServer>;
};

function openerFor(platform: string): (url: string) => void {
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const argsFor = (url: string): string[] =>
    platform === "win32" ? ["/c", "start", "", url] : [url];

  return (url) => {
    const child = spawn(command, argsFor(url), { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  };
}

function waitForSignals(): Promise<void> {
  return new Promise((settle) => {
    const finish = (): void => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      settle();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function bundledUiDir(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = join(here, "ui");
    return statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function usage(message: string): CliResult {
  return { stdout: "", stderr: `keelson start : ${message}\n`, exitCode: 2 };
}

export async function startCommand(
  argv: readonly string[],
  cwd: string,
  deps: StartDeps = {},
): Promise<CliResult> {
  const parsed = parseCommandArgs<{ port?: string; "no-open"?: boolean }>(argv, {
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (!parsed.ok) {
    return usage(parsed.message);
  }

  if (parsed.positionals.length > 1) {
    return usage(`un seul dossier attendu, « ${parsed.positionals[1]} » est en trop`);
  }

  const target = parsed.positionals[0] ?? cwd;
  const root = isAbsolute(target) ? target : resolve(cwd, target);

  try {
    if (!statSync(root).isDirectory()) {
      return usage(`« ${root} » n'est pas un dossier`);
    }
  } catch {
    return usage(`dossier introuvable : ${root}`);
  }

  let port = 0;
  if (parsed.values.port !== undefined) {
    const candidate = Number(parsed.values.port);
    if (!Number.isInteger(candidate) || candidate < 0 || candidate > 65_535) {
      return usage(`--port attend un entier entre 0 et 65535, reçu « ${parsed.values.port} »`);
    }
    port = candidate;
  }

  const uiDir = bundledUiDir();
  const serve = deps.serve ?? createServer;

  let server: KeelsonServer;
  try {
    server = await serve({ root, port, ...(uiDir === undefined ? {} : { uiDir }) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const busy = reason.includes("EADDRINUSE");
    return usage(
      busy
        ? `le port ${port} est déjà utilisé, choisissez-en un autre avec --port`
        : `impossible de démarrer le serveur : ${reason}`,
    );
  }

  const banner = `Keelson running at ${server.url}\n`;
  const write = deps.write ?? ((chunk: string) => void process.stdout.write(chunk));
  write(banner);

  if (parsed.values["no-open"] !== true) {
    (deps.open ?? openerFor(process.platform))(server.url);
  }

  await (deps.waitForShutdown ?? waitForSignals)();
  await server.close();

  return { stdout: banner, stderr: "", exitCode: 0 };
}
