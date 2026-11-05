export type SourceRange = {
  start: number;
  end: number;
};

export type Origin =
  | { kind: "local" }
  | { kind: "default" }
  | { kind: "extends"; template: string }
  | { kind: "anchor"; name: string }
  | { kind: "reference"; path: string[] }
  /** La valeur vient de la définition du même nom dans un fichier inclus, que le fichier courant
   *  n'a pas surchargée. */
  | { kind: "include"; file: string };

export type Valued<T> = {
  value: T;
  origin: Origin;
};

export type Need = {
  job: string;
  optional: boolean;
  artifacts: boolean;
};

export type Environment = {
  name: string;
  url?: string;
  action?: string;
};

export type OpaqueBlock = {
  key: string;
  range: SourceRange;
  /** Le fichier dont `range` est un offset. Un bloc opaque est rendu à l'écran en coupant les
   *  octets du texte : lire ceux d'un autre fichier afficherait un fragment pris ailleurs. */
  file: string;
};

/** `file` est le chemin, relatif à la racine du dépôt, du fichier où vit la **dernière** définition
 *  de l'élément dans l'ordre de fusion de GitLab — donc celui qu'un utilisateur éditerait, et le
 *  seul que Keelson accepte de réécrire quand c'est le fichier principal. `range` est un offset
 *  dans le texte de **ce** fichier, pas dans celui du fichier principal. */
export type Stage = {
  name: string;
  implicit: boolean;
  range: SourceRange | null;
  file: string;
};

/** Ce qu'un job exécute, valeurs effectives : c'est sur quoi la détection des couches travaille.
 *  Neutre vis-à-vis du fournisseur. `script` met bout à bout `before_script`, `script` et
 *  `after_script`. */
export type JobSignals = {
  image: string | null;
  script: string[];
  /** Les actions GitHub (`owner/repo@ref`) des étapes du job. Absent ailleurs. */
  actions?: string[];
};

export type Job = {
  id: string;
  stage: Valued<string>;
  needs: Valued<Need[]> | null;
  /** La liste `needs` porte des items que l'IR ne modélise pas, inter-projets ou imbriqués : la
   *  réécrire les perdrait. Absent quand il n'y en a pas. */
  unmodelledNeeds?: true;
  environment: Valued<Environment> | null;
  extends: string[];
  opaque: OpaqueBlock[];
  signals: JobSignals;
  range: SourceRange;
  file: string;
};

export type Template = {
  id: string;
  range: SourceRange;
  file: string;
};

/** Un `include` dont le contenu manque au pipeline affiché : les quatre formes distantes, et
 *  `local` quand l'appelant n'a fourni aucun lecteur ou que le fichier n'a pas pu être résolu.
 *  `detail` est la valeur telle qu'elle est écrite, pour que l'écran puisse dire ce qui manque et
 *  non seulement qu'il manque quelque chose. */
export type UnresolvedInclude = {
  form: "local" | "remote" | "project" | "template" | "component" | "workflow";
  detail: string;
  /** Le fichier qui porte la clé `include`, pas la cible. */
  from: string;
  range: SourceRange | null;
};

export type Pipeline = {
  stages: Stage[];
  jobs: Job[];
  templates: Template[];
  opaque: OpaqueBlock[];
  /** Le fichier principal : celui que Keelson écrit. */
  main: string;
  /** Le fichier principal et chaque fichier inclus résolu, dans l'ordre de fusion. */
  files: string[];
  unresolved: UnresolvedInclude[];
  /** Absent sur GitLab. `github` : les stages sont dérivés de `needs` (ADR 0013). */
  provider?: "github";
};

/** Un pipeline sans rien dedans, nommé une seule fois : l'UI en a besoin tant que rien n'est
 *  chargé, et `parse` quand la racine du fichier n'est pas une map. */
export function emptyPipeline(main: string): Pipeline {
  return { stages: [], jobs: [], templates: [], opaque: [], main, files: [], unresolved: [] };
}

/** Plusieurs fichiers vus comme un seul dépôt, pour ce qui porte sur le dépôt et non sur un fichier :
 *  la toolchain, `keelson coverage` sans argument. Un job de même nom garde sa première définition. */
export function mergePipelines(pipelines: readonly Pipeline[]): Pipeline {
  const first = pipelines[0];
  if (first === undefined) {
    return emptyPipeline("");
  }
  const jobs = new Map<string, Job>();
  for (const job of pipelines.flatMap((pipeline) => pipeline.jobs)) {
    if (!jobs.has(job.id)) {
      jobs.set(job.id, job);
    }
  }
  const stages = new Map<string, Stage>();
  for (const stage of pipelines.flatMap((pipeline) => pipeline.stages)) {
    if (!stages.has(stage.name)) {
      stages.set(stage.name, stage);
    }
  }
  return {
    ...first,
    jobs: [...jobs.values()],
    stages: [...stages.values()],
    templates: pipelines.flatMap((pipeline) => pipeline.templates),
    opaque: pipelines.flatMap((pipeline) => pipeline.opaque),
    files: [...new Set(pipelines.flatMap((pipeline) => pipeline.files))],
    unresolved: pipelines.flatMap((pipeline) => pipeline.unresolved),
  };
}

/** Un pipeline est **partiel** dès qu'un include n'a pas été résolu : des jobs peuvent manquer à
 *  l'écran. Dérivé plutôt que stocké — un booléen stocké peut mentir, celui-ci ne peut pas. */
export function isPartial(pipeline: Pipeline): boolean {
  return pipeline.unresolved.length > 0;
}

export function findJob(pipeline: Pipeline, id: string): Job | undefined {
  return pipeline.jobs.find((candidate) => candidate.id === id);
}

export function stageIndex(pipeline: Pipeline, name: string): number {
  return pipeline.stages.findIndex((stage) => stage.name === name);
}
