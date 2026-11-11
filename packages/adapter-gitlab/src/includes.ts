import type { Diagnostic, SourceRange, UnresolvedInclude } from "@keelson/core";
import { INCLUDE_CYCLE, INCLUDE_LIMIT_EXCEEDED, INCLUDE_NOT_FOUND } from "@keelson/core";
import type { Document } from "yaml";
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type YAMLMap } from "yaml";
import type { AnyNode } from "./resolve.ts";
import { contentRange, localPair, REFERENCE_TAG } from "./resolve.ts";

/** “The maximum number of nested included files for a pipeline is 150.”
 *  <https://docs.gitlab.com/ci/yaml/includes/>, retrieved on 2026-10-23. It is a **total count**,
 *  not a nesting depth: GitLab documents no depth limit, and inventing one would make Keelson
 *  stricter than its target. Recursion is bounded by cycle detection. */
export const MAX_INCLUDED_FILES = 150;

const YAML_EXTENSIONS = [".yml", ".yaml"] as const;

const REMOTE_URL = /^https?:\/\//i;

/** The include forms that leave the repository, and that Keelson therefore does not resolve. The
 *  vocabulary is GitLab's. */
const REMOTE_KEYS = ["remote", "project", "template", "component"] as const;

export type IncludeReader = {
  /** Normalised `path`: relative to the repository root, `/` separators, no leading `/`.
   *  `null` if the file does not exist or is not readable. */
  read(path: string): string | null;
  /** Every `.yml` and `.yaml` file in the repository, normalised the same way. Only called for an
   *  include that carries a wildcard. */
  candidates(): readonly string[];
  /** Whether `path`, which `read` refused, exists but resolves outside the repository root. */
  outsideRoot?(path: string): boolean;
};

/** “You can use certain CI/CD variables” in `include:local`: such a path is only known when the
 *  pipeline runs. */
const VARIABLE = /\$\{?[A-Za-z_]/;

export type ParsedFile = {
  file: string;
  text: string;
  yaml: Document.Parsed;
  lineCounter: LineCounter;
};

type Entry =
  | { kind: "local"; value: string; range: SourceRange | null }
  | { kind: "remote"; form: UnresolvedInclude["form"]; detail: string; range: SourceRange | null }
  | { kind: "malformed"; range: SourceRange | null };

export type Normalised =
  | { ok: true; path: string }
  | { ok: false; reason: "notYaml" | "outsideRoot"; path: string };

/** GitLab requires “a full path relative to the root directory (`/`)” and the `.yml` or `.yaml`
 *  extension. Refusing a path that leaves the root is a security measure, not a matter of
 *  conformance: Keelson's server reads the disk on behalf of a web page open in the user's
 *  browser. */
export function normaliseIncludePath(raw: string): Normalised {
  const unified = raw.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = unified.split("/").filter((segment) => segment !== "" && segment !== ".");

  if (segments.length === 0 || segments.includes("..")) {
    return { ok: false, reason: "outsideRoot", path: raw };
  }

  const path = segments.join("/");
  if (!YAML_EXTENSIONS.some((extension) => path.endsWith(extension))) {
    return { ok: false, reason: "notYaml", path: raw };
  }

  return { ok: true, path };
}

export function hasWildcard(path: string): boolean {
  return path.includes("*");
}

/** Translation of GitLab's wildcards. “You can use `*` and `**` wildcards in the file path”:
 *  `*` stays within a segment, `**` crosses `/`. The documentation's examples pin this down —
 *  `configs/*.yml` ignores subfolders, `configs/**.yml` takes them, and `configs/**` followed by
 *  `/*.yml` takes **only** the subfolders. */
export function matchesWildcard(pattern: string, path: string): boolean {
  let source = "";
  let index = 0;

  while (index < pattern.length) {
    const character = pattern[index] ?? "";
    if (character === "*") {
      const double = pattern[index + 1] === "*";
      source += double ? ".*" : "[^/]*";
      index += double ? 2 : 1;
      continue;
    }
    source += character.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }

  return new RegExp(`^${source}$`).test(path);
}

function stringOf(node: AnyNode): string | null {
  return isScalar(node) && typeof node.value === "string" ? node.value : null;
}

/** Readable detail of an unresolved include: the value as written, and the `file:` when the form
 *  carries one — a `project:` without its `file:` does not say what is missing. */
function detailOf(map: YAMLMap, key: string, value: string): string {
  const file = stringOf(localPair(map, "file")?.value as AnyNode);
  return key === "project" && file !== null ? `${value} / ${file}` : value;
}

function entryOf(node: AnyNode): Entry {
  const range = contentRange(node);

  const literal = stringOf(node);
  if (literal !== null) {
    // The short form means `include:remote` for a URL: “If the file is a remote file, it is
    // the same as include:remote”. Treating it as a local path rewrote it and wrongly blamed a
    // missing file.
    return REMOTE_URL.test(literal)
      ? { kind: "remote", form: "remote", detail: literal, range }
      : { kind: "local", value: literal, range };
  }

  if (!isMap(node)) {
    return { kind: "malformed", range };
  }

  for (const key of REMOTE_KEYS) {
    const value = stringOf(localPair(node, key)?.value as AnyNode);
    if (value !== null) {
      return { kind: "remote", form: key, detail: detailOf(node, key, value), range };
    }
  }

  const local = stringOf(localPair(node, "local")?.value as AnyNode);
  return local === null ? { kind: "malformed", range } : { kind: "local", value: local, range };
}

/** The entries of a file's `include` key, in their written order — which is their merge
 *  order. */
export function includeEntries(root: YAMLMap): Entry[] {
  const pair = localPair(root, "include");
  if (pair === undefined) {
    return [];
  }

  const node = pair.value as AnyNode;
  if (isSeq(node)) {
    return node.items.map((item) => entryOf(item as AnyNode));
  }
  const range = contentRange(node);
  if (range === null || range.start === range.end) {
    return [{ kind: "malformed", range: contentRange(pair.key as AnyNode) }];
  }
  return [entryOf(node)];
}

export function parseIncludedFile(file: string, text: string): ParsedFile {
  const lineCounter = new LineCounter();
  const yaml = parseDocument(text, {
    lineCounter,
    keepSourceTokens: true,
    merge: true,
    customTags: [{ tag: REFERENCE_TAG, collection: "seq" }],
  });
  return { file, text, yaml, lineCounter };
}

export type IncludeResolution = {
  /** The included files **without** the main file, in GitLab's merge order: a file's includes
   *  come before it, and the main file comes last — which is why it is not in this list. */
  files: ParsedFile[];
  /** The includes we cannot resolve: remote forms, and `local` when the caller provided no
   *  reader. Each one yields an info-level `INCLUDE_UNRESOLVED`. */
  unresolved: UnresolvedInclude[];
  /** The `include: local` entries we tried to resolve and that **failed**: missing path, outside
   *  the root, wrong extension, unreadable entry. They are already reported by an error-level
   *  `INCLUDE_NOT_FOUND`, so they do not get a second, info-level one — but the pipeline lacks
   *  them all the same, which is why they count as unresolved. */
  failed: UnresolvedInclude[];
  diagnostics: Diagnostic[];
};

type State = {
  read: IncludeReader | null;
  files: ParsedFile[];
  unresolved: UnresolvedInclude[];
  failed: UnresolvedInclude[];
  diagnostics: Diagnostic[];
  candidates: readonly string[] | null;
  /** Files **entered** during resolution. Counted on entry, not on exit: `walk` descends before
   *  pushing, so a count based on `files` would stay at zero throughout the descent and the limit
   *  would never trigger on a deep chain. */
  entered: number;
  stopped: boolean;
};

/** A failing local include is **two** things at once: an error to fix, and a hole in the
 *  displayed pipeline. The diagnostic states the first; `failed` states the second, without which
 *  `isPartial()` would stay false on the most common defect of a real repository — a typo in a
 *  path — and the screen would suggest the pipeline is complete while it lacks everything that
 *  file contributed. */
function notFound(
  state: State,
  from: string,
  detail: string,
  range: SourceRange | null,
  params: Extract<Diagnostic, { code: typeof INCLUDE_NOT_FOUND }>["params"],
): void {
  state.diagnostics.push({ code: INCLUDE_NOT_FOUND, severity: "error", params, range, file: from });
  state.failed.push({ form: "local", detail, from, range });
}

function expand(
  state: State,
  read: IncludeReader,
  from: string,
  entry: Extract<Entry, { kind: "local" }>,
): string[] {
  const normalised = normaliseIncludePath(entry.value);
  if (!normalised.ok) {
    notFound(state, from, entry.value, entry.range, {
      reason: normalised.reason,
      path: normalised.path,
    });
    return [];
  }

  if (!hasWildcard(normalised.path)) {
    return [normalised.path];
  }

  state.candidates ??= [...read.candidates()].sort();
  // A wildcard that matches nothing is not an error in GitLab: the list is simply empty. The
  // order is lexicographic (decision D8 of milestone L2b) because the merge order decides which
  // value wins, and an unspecified order would be an unspecified result.
  return state.candidates.filter((candidate) => matchesWildcard(normalised.path, candidate));
}

function walk(state: State, parent: ParsedFile, trail: readonly string[]): void {
  const root = parent.yaml.contents;
  if (!isMap(root)) {
    return;
  }

  for (const entry of includeEntries(root)) {
    if (state.stopped) {
      return;
    }

    if (entry.kind === "malformed") {
      // `detail` is the value as written, as everywhere else. A sentence here would be text
      // produced outside the messages module, which ADR 0002 forbids.
      const written =
        entry.range === null ? "" : parent.text.slice(entry.range.start, entry.range.end);
      notFound(state, parent.file, written.trim(), entry.range, { reason: "malformed" });
      continue;
    }

    if (entry.kind === "remote") {
      state.unresolved.push({
        form: entry.form,
        detail: entry.detail,
        from: parent.file,
        range: entry.range,
      });
      continue;
    }

    const read = state.read;
    if (read === null || VARIABLE.test(entry.value)) {
      // No reader, or a path only known at run time: the include is not missing, it was not
      // looked up. Calling it “missing” would blame the user's file. The pipeline is partial, and
      // that is all Keelson can say about it.
      state.unresolved.push({
        form: "local",
        detail: entry.value,
        from: parent.file,
        range: entry.range,
      });
      continue;
    }

    for (const path of expand(state, read, parent.file, entry)) {
      if (trail.includes(path)) {
        state.diagnostics.push({
          code: INCLUDE_CYCLE,
          severity: "error",
          params: { trail: [...trail.slice(trail.indexOf(path)), path] },
          range: entry.range,
          file: parent.file,
        });
        continue;
      }

      if (state.entered >= MAX_INCLUDED_FILES) {
        state.diagnostics.push({
          code: INCLUDE_LIMIT_EXCEEDED,
          severity: "error",
          params: { limit: MAX_INCLUDED_FILES },
          range: entry.range,
          file: parent.file,
        });
        // What is cut here was not read: the pipeline lacks it, and a missing `extends` target
        // may be in it. Only the first cut entry is named: the rest was not seen.
        state.unresolved.push({
          form: "local",
          detail: path,
          from: parent.file,
          range: entry.range,
        });
        state.stopped = true;
        return;
      }

      const text = read.read(path);
      if (text === null) {
        notFound(state, parent.file, path, entry.range, {
          reason: read.outsideRoot?.(path) === true ? "outsideRoot" : "missing",
          path,
        });
        continue;
      }

      state.entered += 1;
      const parsed = parseIncludedFile(path, text);
      // The included file's includes go **before** it: “nested includes are resolved
      // recursively”, and the last included wins.
      walk(state, parsed, [...trail, path]);
      state.files.push(parsed);
    }
  }
}

export function resolveIncludes(main: ParsedFile, read: IncludeReader | null): IncludeResolution {
  const state: State = {
    read,
    files: [],
    unresolved: [],
    failed: [],
    diagnostics: [],
    candidates: null,
    entered: 0,
    stopped: false,
  };
  walk(state, main, [main.file]);
  return {
    files: state.files,
    unresolved: state.unresolved,
    failed: state.failed,
    diagnostics: state.diagnostics,
  };
}
