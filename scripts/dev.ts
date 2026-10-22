import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "@keelson/server";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(repoRoot, "packages", "ui", "dev-fixture");

export const DEV_TOKEN = "keelson-dev-token";
export const DEV_API_PORT = 5284;

const server = await createServer({ root: fixture, port: DEV_API_PORT, token: DEV_TOKEN });

process.stdout.write(`API de dev sur http://127.0.0.1:${server.port} (fixture : ${fixture})\n`);
process.stdout.write("UI de dev servie par Vite sur http://127.0.0.1:5283\n");

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
