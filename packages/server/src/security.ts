import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const LOOPBACK = "127.0.0.1";

export const TOKEN_HEADER = "x-keelson-token";

export function createToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokensMatch(expected: string, received: string | undefined): boolean {
  if (received === undefined || received === "") {
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(expected), digest(received));
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) {
    return false;
  }
  return host === `${LOOPBACK}:${port}` || host === `localhost:${port}`;
}
