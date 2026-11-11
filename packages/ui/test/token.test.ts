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
  test("reads the token from the query parameter", () => {
    expect(harness("?token=abc123").token).toBe("abc123");
  });

  test("removes the token from the URL", () => {
    const { replaced } = harness("?token=abc123");
    expect(replaced).toEqual([{ url: "/" }]);
  });

  test("keeps the other parameters", () => {
    const { replaced } = harness("?token=abc&debug=1");
    expect(replaced[0]?.url).toBe("/?debug=1");
  });

  test("leaves the URL alone when there is no token", () => {
    const { replaced, token } = harness("?debug=1");
    expect(token).toBeNull();
    expect(replaced).toEqual([]);
  });

  test("returns null on a URL without parameters", () => {
    expect(harness("").token).toBeNull();
  });

  test("an empty token is treated as missing", () => {
    const { replaced, token } = harness("?token=");
    expect(token).toBeNull();
    expect(replaced).toEqual([]);
  });

  test("decodes an encoded token", () => {
    expect(harness("?token=a%2Bb").token).toBe("a+b");
  });
});
