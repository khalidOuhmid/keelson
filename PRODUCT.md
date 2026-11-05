# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Utilisateur qui tranche : l'ingénieur DevSecOps / plateforme.** Il conçoit ou fait évoluer la
chaîne CI et les services de la plateforme (Nexus, Harbor, DefectDojo, Vault, Sentry…) pour
plusieurs équipes. Il connaît le YAML CI, l'édite au quotidien et ouvre Keelson **dans un dépôt
qu'il a sous la main**, en local, pour voir le pipeline, le compléter et écrire la configuration
sans perdre ce qui existe. Quand les besoins des profils divergent (densité d'édition contre
lisibilité d'un constat), c'est son usage qui l'emporte.

Trois audiences secondaires confirmées :

- **Architecte sécurité / RSSI** : audite la couverture OWASP d'un dépôt existant, produit un
  constat, impose des couches requises (`keelson coverage --require`). Consomme surtout l'overlay et
  le rapport, édite peu.
- **Dev lead d'une équipe produit** : ouvre son propre dépôt pour comprendre et corriger son
  pipeline sans être expert CI. A besoin que chaque proposition soit justifiée et vérifiable.
- **Consultant en mission** : intervient sur N dépôts clients, veut un modèle réutilisable et un
  rapport ; à terme, applique une même série d'opérations à une flotte (lot L8).

## Product Purpose

Concevoir visuellement une chaîne DevSecOps **avant** de l'implémenter, en restant branché sur les
fichiers réels du dépôt. Aujourd'hui, la conception se fait soit dans un outil de diagramme
déconnecté du code, soit directement dans le YAML où l'on perd la vue d'ensemble ; dans les deux
cas, personne ne sait dire quelles couches de sécurité sont réellement couvertes ni ce qu'il manque.

Keelson lit et réécrit le YAML CI natif (GitLab CI d'abord, GitHub Actions ensuite), modélise à
côté les services de la plateforme et leurs intégrations avec les jobs, projette la couverture des
13 couches de l'OWASP DevSecOps Guideline plus des catégories plateforme hors OWASP, et propose
depuis un catalogue de 50 à 100 outils des implémentations pour les couches non couvertes.

Succès : l'utilisateur sait, pour un dépôt donné, ce qui est couvert, par quoi, ce qui ne l'est
pas, et repart avec une configuration écrite dans ses fichiers, sans qu'un commentaire, un ordre
de clés ou un anchor ait bougé.

Hors périmètre, définitivement : Keelson ne déploie rien, n'exécute aucun pipeline, ne scanne aucun
code. Il conçoit, documente et écrit de la configuration.

## Positioning

**Le dépôt est la source de vérité, pas Keelson.** Aucun format propriétaire ne remplace le YAML
CI. Keelson ne possède que deux fichiers, `.devsecops/toolchain.yaml` (services et intégrations,
non déductibles du CI) et `.devsecops/layout.json` (positions des nœuds, surcharges de couche).

Ce qu'un outil voisin ne peut pas copier sans changer de nature :

- **L'aller-retour octet pour octet.** Un parse puis emit sans modification produit un fichier
  identique : commentaires, ordre des clés et anchors préservés. Édition par patch en place, jamais
  par régénération. Vérifié par un corpus de 34 fichiers et quatre propriétés fast-check
  (aller-retour, inverse, déterminisme, localité).
- **Ce que le modèle ne comprend pas est conservé tel quel** dans des blocs opaques, jamais
  reconstruit.
- **Rien n'est prescrit sans justification.** Chaque proposition d'outil renvoie à la couche OWASP
  qu'elle couvre, avec sa licence et un snippet vérifiable.
- **Local d'abord.** Pas de service distant, pas de compte : `npx keelson start` et c'est tout.

## Operating Context

- **Lancement** : `npx keelson start` depuis la racine d'un dépôt ouvre une UI web locale
  (Node ≥ 20, sans Bun). Les autres commandes sont en ligne de commande : `validate`, `coverage`,
  `export`, `catalog lint`, et plus tard `apply ops.json`.
- **Matériaux manipulés** : le `.gitlab-ci.yml` du dépôt (puis les workflows GitHub Actions), les
  templates `include` et `extends` (résolus en lecture seule pour l'affichage, jamais réécrits),
  `.devsecops/toolchain.yaml`, `.devsecops/layout.json`.
- **Référentiels** : les 13 couches de l'OWASP DevSecOps Guideline (secrets git, SCA, SAST, IaC,
  supply chain, IAST, sécurité des API, DAST, CNAPP, scan d'infrastructure, scan continu,
  conformité, sécurité IA/LLM) et huit catégories plateforme hors OWASP (SCM, dépôts d'artefacts
  et registres, gestion des secrets, agrégation de vulnérabilités, qualité de code serveur,
  observabilité runtime, sécurité runtime, policy-as-code).
- **Rituels** : conception en amont d'une implémentation, audit d'un dépôt existant, passage en CI
  de `keelson coverage --require` comme garde-fou. Les modifications sont relues en diff git par
  l'utilisateur avant commit : le diff doit rester minimal et lisible.
- **Vues prévues** : Pipeline (stages, jobs, dépendances), Toolchain (services et intégrations),
  Overlay OWASP (couverture projetée, panneau « non couvert » et propositions), Catalogue (outils
  filtrables par couche et licence).

## Capabilities and Constraints

**Livré (lot L1)** : IR du pipeline, adaptateur GitLab CI avec aller-retour validé, opérations
d'édition sérialisables et inversables, `keelson validate` en texte et JSON.

**En cours (lot L2)** : la vue Pipeline dans l'UI, lecture puis édition. Dépendances prévues et non
encore installées : `@xyflow/react` pour les graphes, CodeMirror 6 pour les blocs YAML opaques,
Zustand pour l'état.

**Livré au lot L3** : taxonomie, catalogue de 62 outils, vues Coverage et Catalog, `keelson coverage`
et `keelson catalog lint`.

**Livré au lot L4** : `.devsecops/toolchain.yaml` édité par opérations, inférence des intégrations
confirmée ou écartée, vue Toolchain à positions libres.

**Livré au lot L5** : insertion d'un outil du catalogue avec diff préalable, annulée d'un coup,
`keelson export`.

**Pas encore livré** : GitHub Actions (L6), packaging npm (L7), flotte (L8). Rien n'est utilisable
par un utilisateur final à ce jour.

**Terminologie du modèle** (noms de code, à traduire dans l'UI) : `Pipeline`, `Stage`, `Job`,
`Need` (dépendance entre jobs, avec `optional` et `artifacts`), `Environment`, `Template` (clé
commençant par `.`), `OpaqueBlock` (conservé octet pour octet). Chaque valeur d'un job porte une
`Origin` : `local`, `default`, `extends`, `anchor` ou `reference`, qui dit d'où elle vient et donc
si elle est éditable ici. Côté toolchain : `Service` (instance nommée : nom, type d'outil, URL,
environnement) et `Integration` (`push`, `upload-report`, `fetch-secret`, `notify`). Côté
taxonomie : `Layer` avec `source: owasp | platform`. Côté catalogue : `Tool` avec couches couvertes,
licence, logo, motifs de détection, snippets, `lastVerified`.

**Deux familles de retours** : les **diagnostics** (`Diagnostic`, avec sévérité `error` /
`warning` / `info` et plage dans le fichier) décrivent l'état d'un fichier et n'empêchent rien ; les
**erreurs d'opération** (`OperationError`, sans sévérité) refusent une édition et garantissent
qu'aucune modification n'est écrite. Les codes sont des contrats publics documentés dans
`specs/diagnostics.md`.

**Toute édition est une opération** : objet JSON pur, versionné (`v: 1`), ancré sur un `baseHash`
du texte source ; `apply` rejette un hash périmé (`STALE_DOCUMENT`). Chaque application rend un
`inverse`. L'UI doit donc exposer naturellement annuler/rétablir et détecter un fichier modifié
hors de Keelson.

**Contraintes techniques durables** :

- L'UI tourne en local sur un port fixe (5283 aujourd'hui, configurable prévu au L2).
- Les `include` ne sont pas résolus en L1 : un pipeline affiché peut être partiel, et l'UI doit le
  dire plutôt que le masquer.
- Les packages exécutés chez l'utilisateur n'utilisent aucune API Bun.
- Design et front : React 19, Vite, Tailwind CSS v4, Biome. Tests de composants avec Testing
  Library et happy-dom, E2E avec Playwright. TDD strict, aucun code non testé.

**Langue de l'UI** : **anglais par défaut, textes externalisés dès le lot L2** pour ajouter le
français ensuite. Les specs, le code et les tests restent en français. Les diagnostics rendus
par `core` sont aujourd'hui en français : la cohérence avec une UI en anglais est **un point à
trancher au L2**, non décidé ici.

## Brand Commitments

- **Nom** : Keelson (carlingue, pièce longitudinale posée sur la quille qui tient la structure du
  navire). Aucun logo, aucune charte, aucune palette ni typographie fixées. La métaphore nautique
  n'est pas un engagement : elle n'a pas été retenue comme contrainte.
- **Licence** : Apache-2.0, Copyright 2026 Khalid Ouhmid. Open source, pas de version commerciale
  connue.
- **Voix** (déduite des specs, non encore confirmée pour l'UI) : factuelle, précise, sans
  marketing ; chaque proposition est justifiée et sourcée.
- **Monde visuel : le standard de la catégorie, joué droit.** Décidé au lot L2 (2026-10-21), après
  un tour de directions où la porte de sortie a été prise explicitement. Keelson ressemble à ce que
  son audience ouvre déjà : colonnes de stages, cartes de jobs, arêtes de dépendances, sans-serif
  d'interface, thème sombre par défaut. **Aucune ironie, aucune bizarrerie en contrebande** : la
  convention est l'engagement, pas un compromis. Les directions écartées à ce tour (planche de
  spécification normative avec barres de révision, schéma de câblage électrique, grille japonaise
  haute densité, diagramme de transit nocturne) ne sont pas à ressortir par la fenêtre.
- **Barre de finition : Linear, Vercel, Raycast.** C'est leur *qualité d'exécution* qui est la
  cible, jamais leur mise en page : gris très finement étagés, bordures d'un pixel, un accent
  unique, densité élevée sans surcharge, états de survol et de focus travaillés, clavier de premier
  rang. Un écran de Keelson qui serait moins soigné que ces produits n'est pas fini.

## Evidence on Hand

- **Corpus réel** : 20 templates officiels GitLab CI sous licence MIT
  (`packages/adapter-gitlab/test/corpus/gitlab-templates/`, provenance dans `LICENSES.md`) et 14
  fixtures maison (`edge-cases/`), avec goldens IR. Ce sont les seuls exemples de pipelines
  utilisables pour des démonstrations ou des états de l'UI. **Ne jamais ajouter de fichier de CI
  venant d'un employeur ou d'un client.**
- **Logos d'outils** : aucun embarqué à ce jour. Règle future : Simple Icons (CC0) en priorité, logo
  d'éditeur seulement si sa charte l'autorise explicitement, sinon icône générique de la couche.
- **Absences à ne pas fabriquer** : aucun utilisateur, témoignage, chiffre d'adoption, étude de
  cas, capture d'écran ou benchmark. Le projet est en développement et le README le dit.

## Product Principles

1. **Le fichier de l'utilisateur d'abord.** Toute interaction se juge sur le diff qu'elle produit :
   minimal, local, relisible. Ce que Keelson ne comprend pas, il le montre tel quel et ne le
   reconstruit jamais.
2. **Dire d'où vient chaque chose.** Une valeur héritée d'un `extends`, d'un anchor ou d'un défaut
   n'est pas une valeur locale : l'origine est une information de premier rang, elle conditionne ce
   qui est éditable.
3. **Montrer l'incertitude plutôt que la masquer.** Pipeline partiel, include non résolu,
   diagnostic d'avertissement, fichier modifié hors de l'outil : l'état réel est toujours visible.
4. **Justifier avant de prescrire.** Une couche manquante renvoie à la Guideline ; un outil proposé
   renvoie à sa couche, sa licence et un snippet vérifiable. Jamais de recommandation nue.
5. **Densité d'expert, lisibilité d'audit.** L'ingénieur plateforme édite vite et sans friction ; le
   constat qui en sort doit rester lisible par un RSSI ou un dev lead qui ne connaît pas le CI.

## Accessibility & Inclusion

**WCAG 2.1 AA requis** : contraste, navigation clavier complète, lecteurs d'écran, cibles
tactiles. Les graphes (pipeline, toolchain, overlay) devront avoir un équivalent navigable au
clavier et lisible par un lecteur d'écran, pas seulement une représentation visuelle.
