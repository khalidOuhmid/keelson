/** Ce qui se lance dans une ligne de script, sans exécuter de shell : assez pour ne pas prendre un
 *  argument pour une commande, pas un parseur. Les formes qu'il ne comprend pas restent entières, et
 *  la détection reste une borne (`specs/ecarts.md`). */

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

/** Nomment un fichier ou un mot sans lancer l'outil : `cp renovate.json /tmp` ne prouve rien. */
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

/** Au-delà, une ligne ou une imbrication n'est plus un script mais une entrée hostile : elle reste
 *  entière, et la détection n'y voit qu'une commande. */
const MAX_DEPTH = 8;
const MAX_LINE = 64 * 1024;

function unquoted(word: string): string {
  return word.replace(/^(["'])(.*)\1$/s, "$2");
}

/** Le script passé à `sh -c`, ou `null`. */
function shellArgument(command: string): string | null {
  const nested = /(?:^|[\s/])(?:ba|z|da)?sh\s+(?:-o\s+\S+\s+|-\w+\s+)*-\w*c\s+(.+)$/s.exec(command);
  const direct =
    nested ?? /^eval\s+(.+)$/s.exec(command) ?? /^su\s+(?:-\S*\s+)*-c\s+(.+)$/s.exec(command);
  const distant = direct ?? /^ssh\s+(?:-\S+\s+)*\S+\s+(.+)$/s.exec(command);
  return distant?.[1] === undefined ? null : unquoted(distant[1].trim());
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
    if (WRAPPERS.has(first) || /^\w+=/.test(first)) {
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
  return INERT.has(first) || first.startsWith("#") || INSTALLING.test(command) ? [] : [command];
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
