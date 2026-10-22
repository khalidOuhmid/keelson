import { beforeEach, describe, expect, test } from "bun:test";
import { readToken } from "../src/api/token.ts";

type Replaced = { url: string }[];

function harness(search: string) {
  const replaced: Replaced = [];
  return {
    replaced,
    token: readToken({
      search,
      pathname: "/",
      replaceState: (url: string) => replaced.push({ url }),
    }),
  };
}

beforeEach(() => undefined);

describe("readToken", () => {
  test("lit le token du paramètre de requête", () => {
    expect(harness("?token=abc123").token).toBe("abc123");
  });

  test("retire le token de l'URL", () => {
    const { replaced } = harness("?token=abc123");
    expect(replaced).toEqual([{ url: "/" }]);
  });

  test("conserve les autres paramètres", () => {
    const { replaced } = harness("?token=abc&debug=1");
    expect(replaced[0]?.url).toBe("/?debug=1");
  });

  test("ne touche pas à l'URL quand il n'y a pas de token", () => {
    const { replaced, token } = harness("?debug=1");
    expect(token).toBeNull();
    expect(replaced).toEqual([]);
  });

  test("rend null sur une URL sans paramètre", () => {
    expect(harness("").token).toBeNull();
  });

  test("un token vide est traité comme absent", () => {
    const { replaced, token } = harness("?token=");
    expect(token).toBeNull();
    expect(replaced).toEqual([]);
  });

  test("décode un token encodé", () => {
    expect(harness("?token=a%2Bb").token).toBe("a+b");
  });
});
