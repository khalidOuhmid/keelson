/** What runs in a script line, without executing a shell: enough not to mistake an argument for
 *  a command, not a parser. Forms it does not understand stay whole, and detection remains a bound
 *  (`specs/gaps.md`). */

type Split = { commands: string[]; nested: string[] };

function closing(text: string, from: number): number {
  let depth = 1;
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return text.length;
}

function split(text: string): Split {
  const commands: string[] = [];
  const nested: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  const flush = (): void => {
    commands.push(current);
    current = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1];

    if (char === "\\" && quote !== "'") {
      current += text.slice(index, index + 2);
      index += 1;
      continue;
    }

    if (quote !== "'" && char === "$" && next === "(") {
      const end = closing(text, index + 2);
      nested.push(text.slice(index + 2, end));
      index = end;
      continue;
    }
    if (quote !== "'" && char === "`") {
      const end = text.indexOf("`", index + 1);
      const stop = end === -1 ? text.length : end;
      nested.push(text.slice(index + 1, stop));
      index = stop;
      continue;
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "#" && (current === "" || /\s$/.test(current))) {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end - 1;
      continue;
    }

    const double = char === next && (char === "&" || char === "|");
    if (
      char === ";" ||
      char === "\n" ||
      char === "|" ||
      char === "&" ||
      char === "(" ||
      char === ")"
    ) {
      flush();
      index += double ? 1 : 0;
      continue;
    }
    current += char;
  }
  flush();
  return { commands, nested };
}

/** Name a file or a word without running the tool: `cp renovate.json /tmp` proves nothing. */
const INERT = new Set([
  "[",
  "awk",
  "cat",
  "cd",
  "chmod",
  "chown",
  "cp",
  "echo",
  "export",
  "false",
  "git",
  "grep",
  "head",
  "jq",
  "kubectl",
  "ls",
  "mkdir",
  "mv",
  "printf",
  "rm",
  "sed",
  "source",
  "tail",
  "tar",
  "tee",
  "test",
  "touch",
  "true",
  "type",
  "unset",
  "which",
]);

const WRAPPERS = new Set([
  "command",
  "do",
  "else",
  "env",
  "exec",
  "if",
  "nohup",
  "sudo",
  "then",
  "time",
  "while",
]);

const INSTALLING =
  /^(apt-get|apt|apk|yum|dnf|brew|pip3?|npm|gem|go|cargo)\s+(-\S+\s+)*(install|add|i)\b/;

/** Beyond this, a line or a nesting is no longer a script but hostile input: it stays whole, and
 *  detection sees only one command in it. */
const MAX_DEPTH = 8;
const MAX_LINE = 64 * 1024;

function unquoted(word: string): string {
  return word.replace(/^(["'])(.*)\1$/s, "$2");
}

/** The script passed to `sh -c`, or `null`. */
const isShell = (word: string): boolean =>
  /^(?:ba|z|da)?sh$/.test(word.slice(word.lastIndexOf("/") + 1));

/** The commands that run the shell passed to them as an argument. */
const CARRIERS = new Set(["docker", "podman", "find"]);

/** The `xargs` options that take a separate value. */
const XARGS_VALUES =
  /^(-[adEILnPs]|--(arg-file|delimiter|max-args|max-lines|max-procs|max-chars|process-slot-var))$/;

/** The command `xargs` runs, its options removed: `xargs grep x` searches. */
function afterXargs(command: string): string {
  const words = [...command.matchAll(/\S+/g)];
  let index = 1;
  while (words[index]?.[0].startsWith("-") === true) {
    index += XARGS_VALUES.test(words[index]?.[0] ?? "") ? 2 : 1;
  }
  const start = words[index]?.index;
  return start === undefined ? "" : command.slice(start);
}

/** The `ssh` options that take a value. */
const SSH_VALUES = /^-[bcDEeFIiJLlmOopQRSWw]$/;

const isQuoted = (word: string): boolean => /^["']/.test(word);

/** The script passed to `sh -c`, `su -c`, `eval` or `ssh`, `""` when it is read from standard
 *  input, or `null`. Word by word, quotes included:
 *  a quoted `sh -c` is not an execution, and a regex over repeated options can blow up. */
function shellArgument(command: string): string | null {
  const words = [...command.matchAll(/"[^"]*"|'[^']*'|\S+/g)];
  const text = (index: number): string => words[index]?.[0] ?? "";
  const head = text(0);
  const rest = (index: number): string | null => {
    const start = words[index]?.index;
    return start === undefined ? null : unquoted(command.slice(start).trim());
  };
  /** The script is a single word if quoted; what follows it are its arguments. */
  const script = (index: number): string | null =>
    isQuoted(text(index)) ? unquoted(text(index)) : rest(index);

  if (head === "eval") {
    return rest(1);
  }
  if (head === "ssh") {
    let index = 1;
    while (text(index).startsWith("-")) {
      index += SSH_VALUES.test(text(index)) ? 2 : 1;
    }
    return rest(index + 1);
  }

  const carried = CARRIERS.has(head);
  const shell =
    isShell(head) || head === "su" ? 0 : carried ? words.findIndex((w) => isShell(w[0])) : -1;
  if (shell === -1) {
    return null;
  }

  for (let index = shell + 1; index < words.length; index += 1) {
    const word = text(index);
    if (word === "--") {
      return null;
    }
    if (/^-\w*c$/.test(word)) {
      // After a carrier, only a quoted script counts: `docker exec c grep sh -c x` searches.
      return carried && !isQuoted(text(index + 1)) ? null : script(index + 1);
    }
    // `-s` reads the script from standard input: what follows are its arguments.
    if (/^-\w*s\w*$/.test(word) && head !== "su") {
      return "";
    }
    if (word === "-o") {
      index += 1;
    } else if (!word.startsWith("-") && head !== "su") {
      return null;
    }
  }
  return null;
}

function resolved(raw: string, depth: number): string[] {
  let command = raw.trim();
  while (true) {
    if (/^command\s+-[vVp]/.test(command)) {
      return [];
    }
    const measured = /^(?:timeout(?:\s+-\S+)*\s+\S+|nice(?:\s+-n\s+\S+|\s+-\S+)?)\s+/.exec(command);
    if (measured !== null) {
      command = command.slice(measured[0].length).trim();
      continue;
    }
    const first = command.split(/\s+/, 1)[0] ?? "";
    if (first === "xargs") {
      command = afterXargs(command).trim();
    } else if (WRAPPERS.has(first) || /^\w+=/.test(first)) {
      command = command.slice(first.length).trim();
    } else {
      break;
    }
  }
  if (command === "") {
    return [];
  }

  const script = shellArgument(command);
  if (script !== null) {
    return executedCommands(script, depth + 1);
  }

  const remote = /^kubectl\s+exec\s.*?\s--\s+(.+)$/s.exec(command);
  if (remote?.[1] !== undefined) {
    return executedCommands(remote[1], depth + 1);
  }

  const first = command.split(/\s+/, 1)[0] ?? "";
  // A quoted string containing a space is a sentence, not a path or a URL to detect.
  const words = command.replace(/"[^"]*\s[^"]*"|'[^']*\s[^']*'/g, '""');
  return INERT.has(first) || first.startsWith("#") || INSTALLING.test(command) ? [] : [words];
}

export function executedCommands(line: string, depth = 0): string[] {
  if (depth > MAX_DEPTH || line.length > MAX_LINE) {
    return [line];
  }
  const joined = line.replace(/\\\r?\n/g, " ");
  const { commands, nested } = split(joined);
  return [
    ...commands.flatMap((command) => resolved(command, depth)),
    ...nested.flatMap((command) => executedCommands(command, depth + 1)),
  ];
}
