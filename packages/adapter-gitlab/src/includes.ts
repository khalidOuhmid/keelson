import type { Diagnostic, SourceRange, UnresolvedInclude } from "@keelson/core";
import { INCLUDE_CYCLE, INCLUDE_LIMIT_EXCEEDED, INCLUDE_NOT_FOUND } from "@keelson/core";
import type { Document } from "yaml";
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type YAMLMap } from "yaml";
import type { AnyNode } from "./resolve.ts";
import { contentRange, localPair, REFERENCE_TAG } from "./resolve.ts";

/** « The maximum number of nested included files for a pipeline is 150. »
 *  <https://docs.gitlab.com/ci/yaml/includes/>, consulté le 2026-10-23. C'est un **compte total**,
 *  pas une profondeur de nid : GitLab ne documente aucune limite de profondeur, et en inventer une
 *  rendrait Keelson plus strict que sa cible. La récursion est bornée par la détection de cycle. */
export const MAX_INCLUDED_FILES = 150;

const YAML_EXTENSIONS = [".yml", ".yaml"] as const;

/** Les formes d'include qui sortent du dépôt, et que Keelson ne résout donc pas. Le vocabulaire
 *  est celui de GitLab. */
const REMOTE_KEYS = ["remote", "project", "template", "component"] as const;

export type IncludeReader = {
  /** `path` normalisé : relatif à la racine du dépôt, séparateurs `/`, sans `/` de tête.
   *  `null` si le fichier n'existe pas ou n'est pas lisible. */
  read(path: string): string | null;
  /** Tous les fichiers `.yml` et `.yaml` du dépôt, normalisés de la même façon. N'est appelé que
   *  pour un include qui porte un joker. */
  candidates(): readonly string[];
};

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

/** GitLab exige « a full path relative to the root directory (`/`) » et l'extension `.yml` ou
 *  `.yaml`. Le refus d'un chemin qui sort de la racine est une mesure de sécurité et non une
 *  conformité : le serveur de Keelson lit le disque pour le compte d'une page web ouverte dans le
 *  navigateur de l'utilisateur. */
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

/** Traduction des jokers de GitLab. « You can use `*` and `**` wildcards in the file path » :
 *  `*` reste dans un segment, `**` traverse les `/`. Les exemples de la documentation le fixent —
 *  `configs/*.yml` ignore les sous-dossiers, `configs/**.yml` les prend, et `configs/**` suivi de
 *  `/*.yml` ne prend **que** les sous-dossiers. */
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

/** Détail lisible d'un include non résolu : la valeur telle qu'elle est écrite, et le `file:`
 *  quand la forme en porte un — un `project:` sans son `file:` ne dit pas ce qui manque. */
function detailOf(map: YAMLMap, key: string, value: string): string {
  const file = stringOf(localPair(map, "file")?.value as AnyNode);
  return key === "project" && file !== null ? `${value} / ${file}` : value;
}

function entryOf(node: AnyNode): Entry {
  const range = contentRange(node);

  const literal = stringOf(node);
  if (literal !== null) {
    return { kind: "local", value: literal, range };
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

/** Les entrées de la clé `include` d'un fichier, dans leur ordre d'écriture — qui est leur ordre
 *  de fusion. */
export function includeEntries(root: YAMLMap): Entry[] {
  const pair = localPair(root, "include");
  if (pair === undefined) {
    return [];
  }

  const node = pair.value as AnyNode;
  return isSeq(node) ? node.items.map((item) => entryOf(item as AnyNode)) : [entryOf(node)];
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
  /** Les fichiers inclus **sans** le fichier principal, dans l'ordre de fusion de GitLab : les
   *  includes d'un fichier viennent avant lui, et le fichier principal vient en dernier — c'est
   *  pourquoi il n'est pas dans cette liste. */
  files: ParsedFile[];
  unresolved: UnresolvedInclude[];
  diagnostics: Diagnostic[];
};

type State = {
  read: IncludeReader | null;
  files: ParsedFile[];
  unresolved: UnresolvedInclude[];
  diagnostics: Diagnostic[];
  candidates: readonly string[] | null;
  stopped: boolean;
};

function notFound(
  state: State,
  from: string,
  range: SourceRange | null,
  params: Extract<Diagnostic, { code: typeof INCLUDE_NOT_FOUND }>["params"],
): void {
  state.diagnostics.push({ code: INCLUDE_NOT_FOUND, severity: "error", params, range, file: from });
}

function expand(
  state: State,
  read: IncludeReader,
  from: string,
  entry: Extract<Entry, { kind: "local" }>,
): string[] {
  const normalised = normaliseIncludePath(entry.value);
  if (!normalised.ok) {
    notFound(state, from, entry.range, { reason: normalised.reason, path: normalised.path });
    return [];
  }

  if (!hasWildcard(normalised.path)) {
    return [normalised.path];
  }

  state.candidates ??= [...read.candidates()].sort();
  // Un joker qui ne correspond à rien n'est pas une erreur chez GitLab : la liste est simplement
  // vide. L'ordre est lexicographique (décision D8 du lot L2b) parce que l'ordre de fusion décide
  // quelle valeur gagne, et qu'un ordre non spécifié serait un résultat non spécifié.
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
      notFound(state, parent.file, entry.range, { reason: "malformed" });
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
    if (read === null) {
      // Aucun lecteur : l'include n'est pas introuvable, il n'a pas été cherché. Le dire
      // « missing » accuserait le fichier de l'utilisateur d'un choix de l'appelant. Le pipeline
      // est partiel, et c'est tout ce que Keelson peut en dire.
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

      if (state.files.length >= MAX_INCLUDED_FILES) {
        state.diagnostics.push({
          code: INCLUDE_LIMIT_EXCEEDED,
          severity: "error",
          params: { limit: MAX_INCLUDED_FILES },
          range: entry.range,
          file: parent.file,
        });
        state.stopped = true;
        return;
      }

      const text = read.read(path);
      if (text === null) {
        notFound(state, parent.file, entry.range, { reason: "missing", path });
        continue;
      }

      const parsed = parseIncludedFile(path, text);
      // Les includes du fichier inclus passent **avant** lui : « nested includes are resolved
      // recursively », et le dernier inclus gagne.
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
    diagnostics: [],
    candidates: null,
    stopped: false,
  };
  walk(state, main, [main.file]);
  return { files: state.files, unresolved: state.unresolved, diagnostics: state.diagnostics };
}
