import type {
  Diagnostic,
  Job,
  OpaqueBlock,
  Pipeline,
  SourceRange,
  Stage,
  Template,
  UnresolvedInclude,
} from "@keelson/core";
import {
  emptyPipeline,
  hashText,
  INCLUDE_UNRESOLVED,
  INVALID_YAML,
  JOB_WITHOUT_SCRIPT,
} from "@keelson/core";
import type { Document } from "yaml";
import { isMap, isSeq, type YAMLMap } from "yaml";
import { DEFAULT_STAGE, DEFAULT_STAGES, isReservedTopLevel } from "./defaults.ts";
import type { GitlabDocument } from "./document.ts";
import {
  type IncludeReader,
  type ParsedFile,
  parseIncludedFile,
  resolveIncludes,
} from "./includes.ts";
import {
  type AnyNode,
  contentRange,
  type Definition,
  definesKey,
  extendsOf,
  keyOf,
  localPair,
  localPairs,
  MODELLED_JOB_KEYS,
  pairRange,
  type ResolveContext,
  resolveEnvironment,
  resolveNeeds,
  resolveStage,
  sourcesFor,
} from "./resolve.ts";

/** Le nom conventionnel du fichier d'entrée. Sert de défaut quand l'appelant n'a pas de chemin à
 *  donner — un `parse(text)` nu, dans un test ou un outil. */
export const GITLAB_CI_FILE = ".gitlab-ci.yml";

export type ParseOptions = {
  /** Chemin du fichier principal, relatif à la racine du dépôt. */
  file?: string;
  /** Absent ⇒ aucun `include` n'est résolu, et chacun est signalé par sa forme. */
  read?: IncludeReader | undefined;
};

export type ParseResult = {
  document: GitlabDocument;
  pipeline: Pipeline;
  diagnostics: Diagnostic[];
  hash: string;
};

const SCRIPT_KEYS = ["script", "run", "trigger"] as const;

function emptyRange(): SourceRange {
  return { start: 0, end: 0 };
}

function defaultStages(main: string): Stage[] {
  return DEFAULT_STAGES.map((name) => ({ name, implicit: true, range: null, file: main }));
}

/** La liste `stages` d'un fichier, ou `null` s'il n'en déclare pas d'utilisable. Une liste **écrase**
 *  et ne fusionne pas (« arrays cannot be merged ») : c'est pourquoi l'appelant ne garde que la
 *  dernière dans l'ordre de fusion, au lieu de les concaténer. */
function declaredStages(root: YAMLMap, file: string): Stage[] | null {
  const pair = localPair(root, "stages");
  if (pair === undefined) {
    return null;
  }

  const seq = pair.value as AnyNode;
  if (!isSeq(seq)) {
    return null;
  }

  const stages = seq.items.flatMap((item) => {
    const range = contentRange(item as AnyNode);
    const value = (item as { value?: unknown }).value;
    return typeof value === "string" ? [{ name: value, implicit: false, range, file }] : [];
  });

  return stages.length === 0 ? null : stages;
}

function yamlDiagnostics(parsed: ParsedFile): Diagnostic[] {
  return parsed.yaml.errors.map((error) => ({
    code: INVALID_YAML,
    severity: "error" as const,
    params: { detail: error.message },
    range: { start: error.pos[0], end: error.pos[1] },
    file: parsed.file,
  }));
}

function unresolvedDiagnostics(unresolved: readonly UnresolvedInclude[]): Diagnostic[] {
  return unresolved.map((include) => ({
    code: INCLUDE_UNRESOLVED,
    severity: "info" as const,
    params: { form: include.form, detail: include.detail },
    range: include.range,
    file: include.from,
  }));
}

type Collected = {
  definitions: Map<string, Definition[]>;
  /** Dernière nature connue de la clé dans l'ordre de fusion. Une clé qui est une map dans un
   *  fichier inclus et un scalaire dans le fichier principal n'est pas un job : la dernière
   *  définition décide, comme pour n'importe quelle valeur. */
  kinds: Map<string, "map" | "opaque">;
  opaque: OpaqueBlock[];
  ranges: Map<string, SourceRange>;
};

function collect(order: readonly ParsedFile[]): Collected {
  const collected: Collected = {
    definitions: new Map(),
    kinds: new Map(),
    opaque: [],
    ranges: new Map(),
  };

  for (const parsed of order) {
    const root = parsed.yaml.contents;
    if (!isMap(root)) {
      continue;
    }

    for (const pair of localPairs(root)) {
      const key = keyOf(pair);
      if (key === null || key === "stages") {
        continue;
      }

      const range = pairRange(pair) ?? emptyRange();
      const value = pair.value as AnyNode;

      if (!isMap(value) || isReservedTopLevel(key)) {
        collected.opaque.push({ key, range, file: parsed.file });
        collected.kinds.set(key, "opaque");
        continue;
      }

      collected.definitions.set(key, [
        ...(collected.definitions.get(key) ?? []),
        { map: value, file: parsed.file },
      ]);
      collected.kinds.set(key, "map");
      collected.ranges.set(key, range);
    }
  }

  return collected;
}

export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const main = options.file ?? GITLAB_CI_FILE;
  const mainFile = parseIncludedFile(main, text);
  const hash = hashText(text);
  const document: GitlabDocument = {
    text,
    hash,
    yaml: mainFile.yaml,
    lineCounter: mainFile.lineCounter,
    file: main,
    read: options.read ?? null,
  };

  const resolution = resolveIncludes(mainFile, options.read ?? null);
  const order: ParsedFile[] = [...resolution.files, mainFile];

  const diagnostics: Diagnostic[] = [
    ...order.flatMap(yamlDiagnostics),
    ...resolution.diagnostics,
    ...unresolvedDiagnostics(resolution.unresolved),
  ];

  const files = order.map((parsed) => parsed.file);
  const unresolved = [...resolution.unresolved];

  if (!isMap(mainFile.yaml.contents)) {
    return {
      document,
      pipeline: { ...emptyPipeline(main), files, unresolved },
      diagnostics,
      hash,
    };
  }

  const collected = collect(order);
  const documents = new Map<string, Document.Parsed>(
    order.map((parsed) => [parsed.file, parsed.yaml]),
  );

  const lookup = new Map<string, readonly Definition[]>(
    [...collected.definitions].filter(([key]) => collected.kinds.get(key) === "map"),
  );

  const context: ResolveContext = {
    documents,
    lookup,
    diagnostics,
    /** Dégradé en avertissement **seulement** si un include non résolu peut expliquer l'absence.
     *  La présence d'une clé `include` ne suffit plus : un `include: local` résolu ne cache rien,
     *  et dégrader pour lui masquait de vraies erreurs. */
    extendsSeverity: unresolved.length === 0 ? "error" : "warning",
    main,
  };

  const templates: Template[] = [];
  const jobEntries: { id: string; definitions: readonly Definition[]; range: SourceRange }[] = [];

  for (const [key, definitions] of lookup) {
    const range = collected.ranges.get(key) ?? emptyRange();
    // Le propriétaire est le **dernier** contributeur dans l'ordre de fusion : celui qu'un
    // utilisateur éditerait, et le seul fichier que Keelson acceptera de réécrire.
    const owner = definitions[definitions.length - 1]?.file ?? main;

    if (key.startsWith(".")) {
      templates.push({ id: key, range, file: owner });
    } else {
      jobEntries.push({ id: key, definitions, range });
    }
  }

  const jobs: Job[] = jobEntries.map((entry) => {
    const owner = entry.definitions[entry.definitions.length - 1];
    const ownerFile = owner?.file ?? main;
    const sources = sourcesFor(entry.definitions, { kind: "local" }, context);
    const stage = resolveStage(sources, context) ?? {
      value: DEFAULT_STAGE,
      origin: { kind: "default" as const },
    };

    const jobOpaque: OpaqueBlock[] =
      owner === undefined
        ? []
        : localPairs(owner.map).flatMap((pair) => {
            const key = keyOf(pair);
            if (key === null || MODELLED_JOB_KEYS.includes(key as never)) {
              return [];
            }
            const range = pairRange(pair);
            return range === null ? [] : [{ key, range, file: ownerFile }];
          });

    if (!SCRIPT_KEYS.some((key) => definesKey(sources, key))) {
      diagnostics.push({
        code: JOB_WITHOUT_SCRIPT,
        severity: "warning",
        params: { job: entry.id },
        range: entry.range,
        file: ownerFile,
      });
    }

    return {
      id: entry.id,
      stage,
      needs: resolveNeeds(sources, context),
      environment: resolveEnvironment(sources, context),
      extends: owner === undefined ? [] : extendsOf(owner.map),
      opaque: jobOpaque,
      range: entry.range,
      file: ownerFile,
    };
  });

  const stages =
    order.reduceRight<Stage[] | null>((found, parsed) => {
      if (found !== null) {
        return found;
      }
      const root = parsed.yaml.contents;
      return isMap(root) ? declaredStages(root, parsed.file) : null;
    }, null) ?? defaultStages(main);

  const pipeline: Pipeline = {
    stages,
    jobs,
    templates,
    opaque: collected.opaque,
    main,
    files,
    unresolved,
  };

  return { document, pipeline, diagnostics, hash };
}
