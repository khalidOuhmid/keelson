import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "@keelson/server";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
/** `KEELSON_DEV_FIXTURE=includes` opens the multi-file tree: the default fixture, whose jobs the
 *  E2E tests count, exercises neither included jobs nor the partial-pipeline band. */
const fixtureName =
  process.env.KEELSON_DEV_FIXTURE === "includes" ? "dev-fixture-includes" : "dev-fixture";
const fixture = join(repoRoot, "packages", "ui", fixtureName);

export const DEV_TOKEN = "keelson-dev-token";
export const DEV_API_PORT = 5284;

const server = await createServer({ root: fixture, port: DEV_API_PORT, token: DEV_TOKEN });

process.stdout.write(`dev API on http://127.0.0.1:${server.port} (fixture: ${fixture})\n`);
process.stdout.write("dev UI served by Vite on http://127.0.0.1:5283\n");

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
