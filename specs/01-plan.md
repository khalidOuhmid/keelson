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

**Simple Icons** (CC0) en priorité. Un logo d'éditeur n'est embarqué que si sa charte de marque
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
| L3  | `taxonomy` + `catalog` + overlay OWASP                                         |
| L4  | `toolchain` : fichier, inférence des intégrations, vue                          |
| L5  | Propositions d'outils et insertion de jobs                                     |
| L6  | `adapter-github`                                                               |
| L7  | Packaging open source : documentation, CONTRIBUTING, publication npm            |
| L8  | Flotte : `keelson apply ops.json`, édition de N dépôts depuis un seul endroit    |
