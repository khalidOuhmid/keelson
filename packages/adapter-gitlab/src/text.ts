export function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function indentUnit(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text);
  return match?.[1] ?? "  ";
}

export function lineStart(text: string, offset: number): number {
  const previous = text.lastIndexOf("\n", offset - 1);
  return previous === -1 ? 0 : previous + 1;
}

export function afterLine(text: string, offset: number): number {
  const next = text.indexOf("\n", offset);
  return next === -1 ? text.length : next + 1;
}

export function linePrefix(text: string, offset: number): string {
  return text.slice(lineStart(text, offset), offset);
}

export function blankRunAfter(text: string, offset: number, eol: string): number {
  let cursor = offset;
  while (text.startsWith(eol, cursor)) {
    cursor += eol.length;
  }
  return cursor;
}

export function blankRunBefore(text: string, offset: number, eol: string): number {
  let cursor = offset;
  while (cursor >= eol.length && text.slice(cursor - eol.length, cursor) === eol) {
    const candidate = cursor - eol.length;
    if (candidate >= eol.length && text.slice(candidate - eol.length, candidate) !== eol) {
      break;
    }
    cursor = candidate;
  }
  return cursor;
}
