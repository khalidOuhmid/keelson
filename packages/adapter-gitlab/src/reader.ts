import { type Dirent, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { IncludeReader } from "./includes.ts";

const YAML_EXTENSIONS = [".yml", ".yaml"] as const;

/** Dossiers jamais parcourus pour les candidats d'un joker. `.git` et `node_modules` contiennent
 *  des milliers de fichiers qu'aucun `include` ne peut viser, et les parcourir rendrait le coût du
 *  premier joker proportionnel à la taille du dépôt. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

const MAX_WALK_ENTRIES = 50_000;

function walk(root: string): string[] {
  const found: string[] = [];
  const queue: string[] = [""];

  while (queue.length > 0 && found.length < MAX_WALK_ENTRIES) {
    const relative = queue.shift();
    if (relative === undefined) {
      break;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push(path);
        }
        continue;
      }
      if (YAML_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        found.push(path);
      }
    }
  }

  return found;
}

/** Le lecteur d'includes sur le système de fichiers, partagé par la CLI et par le serveur. Une
 *  seule implémentation : c'est elle qui tient la frontière de la racine, et deux copies de cette
 *  frontière seraient deux endroits où la perdre.
 *
 *  `candidates()` est mémoïsé et n'est calculé qu'au premier joker : un dépôt sans `include` à
 *  joker ne paie jamais le parcours. */
export function createFileReader(root: string): IncludeReader {
  const absoluteRoot = resolve(root);
  const prefix = absoluteRoot.endsWith(sep) ? absoluteRoot : absoluteRoot + sep;
  /** La racine résolue : la racine elle-même peut être atteinte par un lien — un dossier de test
   *  sous `/tmp` l'est sur macOS — et comparer un chemin réel à un préfixe non résolu refuserait
   *  alors tout. */
  let realRoot = absoluteRoot;
  try {
    realRoot = realpathSync(absoluteRoot);
  } catch {}
  const realPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  let listed: string[] | null = null;

  return {
    read(path) {
      const absolute = resolve(absoluteRoot, path);
      // Premier contrôle, lexical, après celui de `normaliseIncludePath`.
      if (!absolute.startsWith(prefix)) {
        return null;
      }

      // Second contrôle, **sur le chemin réel**. Les deux contrôles lexicaux ne voyaient pas les
      // liens symboliques : `ci/fuite.yml → /etc/passwd` passait les deux, et le contenu du
      // fichier visé partait dans la charge envoyée au navigateur. Trouvé par la revue
      // indépendante du 2026-10-23. L'extension était contrôlée sur le **nom du lien**, jamais
      // sur sa cible.
      //
      // Le lien reste permis s'il **reste** sous la racine : un dépôt peut légitimement en
      // contenir, et seule la cible décide.
      let real: string;
      try {
        real = realpathSync(absolute);
      } catch {
        return null;
      }
      if (real !== absoluteRoot && !real.startsWith(realPrefix)) {
        return null;
      }

      try {
        return readFileSync(real, "utf8");
      } catch {
        return null;
      }
    },
    candidates() {
      listed ??= walk(absoluteRoot);
      return listed;
    },
  };
}
