import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "@keelson/server";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
/** `KEELSON_DEV_FIXTURE=includes` ouvre l'arbre multi-fichiers : la fixture par défaut, dont les E2E
 *  comptent les jobs, n'exerce ni les jobs inclus ni la bande de pipeline partiel. */
const fixtureName =
  process.env.KEELSON_DEV_FIXTURE === "includes" ? "dev-fixture-includes" : "dev-fixture";
const fixture = join(repoRoot, "packages", "ui", fixtureName);

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
