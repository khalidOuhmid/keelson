export type Location = {
  search: string;
  hash: string;
  pathname: string;
  replaceState: (url: string) => void;
};

export const TOKEN_PARAM = "token";

export function readToken(location: Location): string | null {
  const params = new URLSearchParams(location.search);
  const token = params.get(TOKEN_PARAM);

  if (token === null || token === "") {
    return null;
  }

  params.delete(TOKEN_PARAM);
  const rest = params.toString();
  location.replaceState(
    `${rest === "" ? location.pathname : `${location.pathname}?${rest}`}${location.hash}`,
  );

  return token;
}

export function browserLocation(): Location {
  return {
    search: window.location.search,
    hash: window.location.hash,
    pathname: window.location.pathname,
    replaceState: (url) => window.history.replaceState(null, "", url),
  };
}
