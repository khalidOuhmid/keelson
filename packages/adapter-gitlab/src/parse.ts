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
  defaultSources,
  definesKey,
  extendsOf,
  hasCrossProjectNeed,
  keyOf,
  localPair,
  localPairs,
  MODELLED_JOB_KEYS,
  pairRange,
  type ResolveContext,
  resolveEnvironment,
  resolveNeeds,
  resolveSignals,
  resolveStage,
  type Source,
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
  /** Le texte de chaque fichier inclus, tel qu'il a été lu pour **cette** analyse. C'est la seule
   *  source qui soit garantie cohérente avec les plages de l'IR : relire les fichiers plus tard
   *  donnerait d'autres octets si l'un d'eux a changé entre-temps. */
  included: Record<string, string>;
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

/** Les blocs opaques d'un job, pris sur **toutes** ses définitions et pas seulement sur celle du
 *  fichier qui le possède. Sans cela, un job défini dans un include et surchargé dans le fichier
 *  principal perdait à l'écran son `script` et ses `artifacts` : ils existent chez l'utilisateur,
 *  le job rendu par GitLab les a, et la seule surface du produit dont la promesse est « ceci est
 *  verbatim » affichait « aucun bloc opaque ».
 *
 *  Une clé définie deux fois ne garde que la dernière, parce que c'est la valeur qui gagne. Chaque
 *  bloc porte son fichier : sa plage est un offset dans ce texte-là. */
function opaqueBlocksOf(definitions: readonly Definition[]): OpaqueBlock[] {
  const blocks = new Map<string, OpaqueBlock>();

  for (const definition of definitions) {
    for (const pair of localPairs(definition.map)) {
      const key = keyOf(pair);
      if (key === null || MODELLED_JOB_KEYS.includes(key as never)) {
        continue;
      }
      const range = pairRange(pair);
      if (range !== null) {
        blocks.set(key, { key, range, file: definition.file });
      }
    }
  }

  return [...blocks.values()];
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
  /** Les deux familles comptent pour le même : il manque au pipeline affiché ce que cet include
   *  apportait. Seule la première reçoit un `INCLUDE_UNRESOLVED` — la seconde a déjà son
   *  `INCLUDE_NOT_FOUND` en erreur, et le dire deux fois ne dirait pas plus. */
  const unresolved = [...resolution.unresolved, ...resolution.failed];

  const included: Record<string, string> = {};
  for (const parsed of resolution.files) {
    included[parsed.file] = parsed.text;
  }

  if (!isMap(mainFile.yaml.contents)) {
    return {
      document,
      pipeline: { ...emptyPipeline(main), files, unresolved },
      diagnostics,
      hash,
      included,
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
    merged: order.map((parsed) => parsed.yaml),
    lookup,
    diagnostics,
    /** Dégradé en avertissement **seulement** si un include qu'on n'a pas pu lire peut expliquer
     *  l'absence : une forme distante, ou un `local` sans lecteur. Un `local` cassé n'en est pas
     *  un, sa cause est déjà une erreur nommée. D'où `resolution.unresolved` et non `unresolved`,
     *  qui compte aussi les cassés parce qu'ils manquent à l'écran (ADR 0007). */
    extendsSeverity: resolution.unresolved.length === 0 ? "error" : "warning",
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

  const defaults = order.flatMap((parsed): Source[] => {
    const root = parsed.yaml.contents;
    return isMap(root) ? defaultSources(root, parsed.file, context) : [];
  });

  const jobs: Job[] = jobEntries.map((entry) => {
    const owner = entry.definitions[entry.definitions.length - 1];
    const ownerFile = owner?.file ?? main;
    const sources = sourcesFor(entry.definitions, { kind: "local" }, context);
    const stage = resolveStage(sources, context) ?? {
      value: DEFAULT_STAGE,
      origin: { kind: "default" as const },
    };

    const jobOpaque = opaqueBlocksOf(entry.definitions);

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
      ...(hasCrossProjectNeed(sources, context) ? { crossProjectNeeds: true as const } : {}),
      environment: resolveEnvironment(sources, context),
      // L'union des `extends` de toutes les définitions, dédoublée : le fichier principal peut
      // ajouter un template sans retirer celui de l'include, et GitLab les applique tous les deux.
      extends: [...new Set(entry.definitions.flatMap((definition) => extendsOf(definition.map)))],
      opaque: jobOpaque,
      signals: resolveSignals(sources, defaults, context),
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

  return { document, pipeline, diagnostics, hash, included };
}
