# Keelson — plan technique

## 1. Sources de vérité

| Source                     | Possède                                                        | Écriture            |
| -------------------------- | -------------------------------------------------------------- | ------------------- |
| YAML CI natif du dépôt     | le pipeline : stages, jobs, dépendances, environnements         | patch en place      |
| `.devsecops/toolchain.yaml`| les services (instances nommées) et les intégrations            | écrit par Keelson   |
| `.devsecops/layout.json`   | positions des nœuds, surcharges de couche                       | écrit par Keelson   |

Un service est une **instance nommée** : nom, type d'outil (référence au catalogue), URL,
environnement. Deux Nexus sur deux environnements sont deux services.

## 2. Modèle

### Pipeline

`Pipeline`, `Stage`, `Job`, `Need` (dépendance entre jobs), `Environment`, et `OpaqueBlock` pour tout
ce que l'IR ne modélise pas : scripts, `rules` complexes, `extends`, `include`. Un bloc opaque est
conservé octet pour octet et réémis tel quel.

### Toolchain

`Service` (instance nommée) et `Integration` entre un job et un service, de type :

- `push` — pousser un artefact ou une image,
- `upload-report` — envoyer un rapport de scan,
- `fetch-secret` — récupérer un secret,
- `notify` — notifier.

### Taxonomie

`Layer` avec un champ `source: owasp | platform`. Une couche OWASP vient de la Guideline ; une
catégorie plateforme est une brique nécessaire que la Guideline ne couvre pas.

### Catalogue

`Tool` : couches couvertes, licence, logo, motifs de détection (pour inférer l'usage depuis les
scripts), snippets par adaptateur, type `job` ou `service`, et `lastVerified`.

## 3. Couches OWASP DevSecOps Guideline (13)

1. Secrets dans les dépôts git
2. SCA — composition des dépendances
3. SAST — analyse statique
4. IaC — sécurité de l'infrastructure as code
5. Supply chain — SBOM, signature, provenance, sécurité du pipeline
6. IAST — analyse interactive
7. Sécurité des API
8. DAST — analyse dynamique
9. CNAPP — protection des applications cloud natives
10. Scan d'infrastructure
11. Scan continu
12. Conformité
13. Sécurité IA / LLM

## 4. Catégories plateforme (hors OWASP)

SCM · dépôts d'artefacts et registres · gestion des secrets · agrégation de vulnérabilités · qualité
de code serveur · observabilité runtime · sécurité runtime · policy-as-code.

## 5. Aller-retour YAML

- Parsing via le **CST** de `yaml` (eemeli), pas seulement l'AST : c'est le CST qui porte les
  commentaires, l'ordre et les anchors.
- Édition par **patch en place** : on ne régénère jamais le document entier.
- **Invariant testé** : un parse → emit sans modification produit des octets identiques. Vérifié au
  lot L1 sur un corpus de 34 fichiers (20 templates officiels MIT de `gitlab-org/gitlab`, 14
  fixtures écrites à la main), et par quatre propriétés fast-check : aller-retour, inverse,
  déterminisme, localité.
- Les `include` distants et les `extends` multi-fichiers sont **résolus en lecture seule** pour
  l'affichage. L'écriture ne touche que le fichier local.

## 6. Intégrations

Inférées depuis les scripts des jobs via les motifs de détection du catalogue, puis **confirmées ou
corrigées** dans `.devsecops/toolchain.yaml`. L'inférence propose, le fichier décide.

## 7. Vues

- **Pipeline** — stages, jobs, dépendances.
- **Toolchain** — services et intégrations autour du pipeline.
- **Overlay OWASP** — couverture projetée, avec un panneau « non couvert » et les propositions
  d'outils du catalogue.
- **Catalogue** — les outils, filtrables par couche et par licence.

## 7 bis. Opérations sérialisables

Toute édition passe par une **opération** : un objet JSON pur, validé par un schéma zod, portant
`v: 1` et un `baseHash` (SHA-256 du texte sur lequel elle a été calculée). `apply` rejette un
`baseHash` périmé (`STALE_DOCUMENT`) et une version inconnue (`UNSUPPORTED_VERSION`).

Chaque application rend un `inverse` : une opération `splice` qui restaure les octets d'origine,
ancrée sur le hash du nouveau texte. `splice` est l'inverse universel — toute opération, aussi
structurée soit-elle, s'annule par un remplacement de plage.

Conséquence : une séquence d'éditions est **transportable**. On peut la calculer d'un côté et
l'appliquer de l'autre, la journaliser, la rejouer, l'annuler. C'est la base du futur **lot L8
(flotte)** : produire des opérations pour N dépôts depuis un seul endroit, puis les appliquer en
masse via `keelson apply ops.json` (hors périmètre de L1, où aucune commande d'application n'est
exposée). Les codes d'erreur étant des contrats publics documentés dans
[diagnostics.md](diagnostics.md), un client distant peut interpréter un refus sans lire le code.

## 7 ter. Serveur local et modèle de sécurité

`npx keelson start` démarre un serveur `node:http` qui **fait autorité sur le disque**. L'UI n'écrit
jamais de fichier et n'exécute pas l'adaptateur : elle envoie des opérations, le serveur les applique
et écrit.

### API

| Méthode | Route | Réponses |
|---|---|---|
| GET | `/api/workspace` | 200 `{ files: [{ path, adapter }] }` |
| GET | `/api/documents/:file` | 200 `{ text, pipeline, diagnostics, hash }` · 404 |
| POST | `/api/documents/:file/operations` | corps `{ op, opId }` → 200 `{ text, pipeline, diagnostics, hash, inverse, touched }` · 400 `INVALID_OPERATION` · 404 · 409 `STALE_DOCUMENT` avec le `hash` courant · 413 · 422 `{ code, params }` |
| GET | `/api/events` | SSE `document.changed { file, hash }`, `document.removed { file }`, heartbeat toutes les 15 s |
| GET | `/*` | bundle de l'UI, repli SPA sur `index.html` |

Les `diagnostics` de ces réponses combinent ceux de `parse` **et** ceux de `validate`, comme le fait
`keelson validate` : l'API et la CLI disent la même chose du même fichier. Toute erreur a la forme
`{ code, params }`, plus `hash` sur le 409, avec les codes et la forme de leurs `params` documentés
dans [diagnostics.md](diagnostics.md). **Aucune clé `message` n'est sur le fil** : le serveur ne
produit pas de texte, le client rend la phrase par `render()` de `@keelson/core/messages`
([ADR 0002](adr/0002-langue-et-messages.md)).

### Garanties d'écriture

- **Atomique** : fichier temporaire dans le même dossier, `fsync`, `rename`, mode du fichier
  d'origine conservé. En cas d'échec le temporaire est supprimé et l'original reste intact.
- **Sérialisée par document** : une file d'attente par fichier, jamais deux `apply` en parallèle sur
  le même document.
- **Idempotente** : chaque requête porte un `opId` ; les 100 derniers par document sont mémorisés
  avec leur réponse, et un `opId` rejoué rend la même réponse sans réécrire.
- **Modifications externes** : le serveur surveille le **dossier** et filtre sur le nom du fichier,
  parce qu'un éditeur remplace souvent le fichier par un `rename` — surveiller le fichier seul
  manquerait l'événement. Après un changement il relit : si le hash est celui qu'il connaît, c'est sa
  propre écriture et il se taît ; sinon il re-parse et émet `document.changed`. Fichier disparu →
  `document.removed`.

### Modèle de sécurité

Le serveur tourne sur la machine de l'utilisateur, aux côtés d'autres pages web ouvertes dans le même
navigateur. Il doit donc se défendre contre elles.

- **Écoute sur `127.0.0.1` uniquement**, sans option pour changer d'interface. Rien n'est exposé au
  réseau local.
- **En-tête `Host` vérifié avant tout traitement** : seuls `127.0.0.1:<port>` et `localhost:<port>`
  sont acceptés, tout le reste rend 403. C'est la défense contre le *DNS rebinding*, par lequel un
  nom contrôlé par un tiers résout vers `127.0.0.1`.
- **Token de session de 32 octets** (`node:crypto`), différent à chaque démarrage. Il est transmis
  une seule fois, dans l'URL ouverte (`?token=`), puis l'UI le retire de la barre d'adresse par
  `history.replaceState` et l'envoie dans l'en-tête `X-Keelson-Token` sur chaque appel. `/api/events`
  le prend en paramètre de requête, `EventSource` ne pouvant pas poser d'en-tête.
- **Comparaison en temps constant** sur des digests SHA-256, donc indépendante de la longueur du
  token présenté.
- **Fichiers bornés à la liste du workspace** : `:file` est résolu par recherche dans cette liste, et
  non par concaténation de chemin. Un chemin contenant `..`, ou un fichier réel mais non détecté,
  rend 404.
- **Corps limité à 1 Mo**, 413 au-delà.
- Le bundle de l'UI est servi sans token : il ne contient aucune donnée de l'utilisateur, et le
  contrôle de `Host` s'applique quand même.

## 8. CLI

| Commande                        | Effet                                                        |
| ------------------------------- | ------------------------------------------------------------ |
| `keelson start`                 | ouvre l'UI web locale                                        |
| `keelson validate`              | valide pipeline et toolchain                                  |
| `keelson coverage --require <couches>` | code ≠ 0 si une couche requise n'est pas couverte      |
| `keelson export`                | exporte le modèle                                             |
| `keelson catalog lint`          | valide le catalogue, signale les outils périmés               |
| `keelson apply ops.json`        | applique une séquence d'opérations (lot L8)                   |

## 9. Logos et licences

**Simple Icons** (CC0) en priorité, apportés par le **paquet npm `simple-icons` en
devDependency** : les SVG arrivent avec leur licence, à une version figée par `bun.lock`, sans
téléchargement à la volée au build ni à l'exécution. Décidé le 2026-10-22 ; `curl` n'est pas
autorisé pour les logos dans `.claude/settings.json`.

Un logo d'éditeur n'est embarqué que si sa charte de marque
l'autorise explicitement ; sinon, icône générique de la couche. La licence de chaque outil est
affichée dans le catalogue.

## 10. Fraîcheur du catalogue

Chaque outil porte un champ `lastVerified`. `keelson catalog lint` signale les outils non vérifiés
depuis plus de six mois.

## 11. Lots

| Lot | Contenu                                                                       |
| --- | ----------------------------------------------------------------------------- |
| L0  | Socle : monorepo, outillage, CI, specs, conventions                            |
| L1  | `core` + `adapter-gitlab`, aller-retour validé sur un corpus réel              |
| L2  | UI vue Pipeline : lecture puis édition                                         |
| L2c | Messages : `core` rend `code` + `params`, anglais unique (ADR 0002)            |
| L2b | Résolution des `include` locaux                                                |
| L3  | `taxonomy` + `catalog` + overlay OWASP                                         |
| L4  | `toolchain` : fichier, inférence des intégrations, vue                          |
| L5  | Propositions d'outils et insertion de jobs                                     |
| L6  | `adapter-github`                                                               |
| L7  | Packaging open source : documentation, CONTRIBUTING, publication npm. La langue n'y est plus traitée : voir l'ADR 0002 et le lot L2c |
| L8  | Flotte : `keelson apply ops.json`, édition de N dépôts depuis un seul endroit    |
