/** The open file lives in the URL hash, so that a reload or a shared address reopens it. The token
 *  never goes there: `readToken` removes it from the query before anything is written. */
const KEY = "file";

export function addressFor(file: string): string {
  return `#${new URLSearchParams({ [KEY]: file }).toString()}`;
}

export function fileInAddress(hash: string): string | null {
  const file = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get(KEY);
  return file === null || file === "" ? null : file;
}

export function rememberFile(file: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${addressFor(file)}`,
  );
}
