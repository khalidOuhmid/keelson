# Suivi des lots

Statut : EN COURS
Lot courant : L2 — étape 9 : `critique` faite, correctifs P0 puis `audit` et `polish`
Prochaine action : corriger ce que `critique` a remonté, **test d'abord**, dans cet ordre. L'ADR
0003 fixe ce qui rouvre le lot et ce qui part en écart : une revue peut rouvrir une promesse, jamais
en ajouter une. Rapport complet et vérifiable dans
`packages/ui/.impeccable/critique/2026-10-22T10-21-57Z__packages-ui-src.md` — score 20/40.

**A. Défauts de correction — `fix:` sous TDD, un commit par défaut.**

1. **Colonnes de stage qui ne contiennent pas leurs jobs** (P0, le plus grave). Sur
   `review/desktop.png`, la colonne `build` affiche « 1 job » et contient `build-image` **et**
   `lint`, dont le sous-titre dit `test` ; la colonne `test` affiche « 2 jobs » avec sa moitié haute
   vide. Cause dans `views/pipeline/layout.ts` : le `x` d'une colonne est déduit du `x` du premier de
   ses nœuds placé par elkjs, avec un repli `index * (nodeWidth + columnGap)` ; rien ne lie la
   géométrie de la boîte à celle de la partition, donc un nœud sans arête comme `lint` fait atterrir
   une boîte sur les nœuds d'une autre colonne. Écrire d'abord le **test d'invariant** exigé par
   l'ADR 0003 : le centre de tout nœud de job tombe dans la boîte de la colonne de **son** stage, sur
   l'ensemble des fixtures. Corriger ensuite en dérivant `x` et `width` de la partition elle-même.
2. **`JobEditor` monté sans `key`** (P0, classe corruption de fichier). `app.tsx` rend
   `<JobEditor job={selected} …>` sans `key`, donc `useState(job.id)`, `needTarget`, `optional`,
   `artifacts`, `environmentName` et `environmentUrl` ne s'initialisent qu'au premier montage :
   sélectionner `build-image` puis `unit-tests` laisse « Job id » à `build-image`, et `Rename`
   soumet `renameJob("unit-tests", "build-image")`. Test : monter l'éditeur, changer de job,
   vérifier que tous les champs reflètent le nouveau. Corriger par `key={selected.id}`, et rendre
   les champs d'environnement contrôlés depuis le job plutôt que depuis un état local vide.
3. **Bouton `Dismiss` mort sur `ErrorBanner`.** `app.tsx` câble son `onDismiss` sur
   `dismissNotice()`, qui ne fait que `set({ notice: null })` et ne touche jamais `error` : la
   bannière d'erreur ne peut pas être fermée. Ajouter `dismissError()` au store.
4. **`pending` rendu nulle part.** Le store le maintient, aucun composant ne le lit, alors que le
   surface brief le déclare load-bearing. Désactiver les éditeurs et montrer un état de progression
   pendant qu'une opération est en vol ; cela supprime aussi les doubles soumissions.
5. **Le `<select>` de stage écrit à chaque `onChange`.** Sous Windows et Linux, les flèches dans un
   select fermé émettent `change` à chaque appui : un utilisateur au clavier qui parcourt les
   options réécrit le YAML une fois par touche. Soumettre sur validation explicite.
6. **Le 409 jette l'erreur du serveur.** `send()` pose `error` puis appelle `reload()`, qui remet
   `error: null` : seul l'avis générique de péremption survit, alors que le brief exige « operation
   rejected (server message shown verbatim) ».
7. **`useHistoryShortcuts` tire dans CodeMirror.** Le garde laisse passer `.cm-content`, un `div`
   en `contenteditable="false"` : Ctrl+Z dans le visualiseur de bloc opaque déclenche une opération
   serveur.
8. **Suppression de job sans confirmation** : un clic réécrit le fichier. Confirmer en nommant le
   job et ce qui en dépend — la machinerie `referencedBy` existe déjà.
9. **Panneau de détail infermable au clavier** : ajouter Échap et un bouton de fermeture, et retirer
   `edgesFocusable`, qui crée des arrêts de tabulation invisibles. Le modèle clavier complet du
   graphe, lui, est en écart (surface nouvelle, exige `shape`).
10. **Reflow WCAG 1.4.10** : à 320 px — soit un zoom 400 % sur un portable de 1280 px — les deux
    colonnes `shrink-0 w-[352px]` écrasent `<main className="min-w-0 flex-1">` à zéro et le graphe
    n'est plus rendu du tout. C'est exactement `review/mobile.png`. Échec de bureau, pas note de bas
    de page mobile.

**B. `/impeccable audit packages/ui/src`**, qui possède le contraste. Deux manquements à
l'engagement WCAG 2.1 AA de `PRODUCT.md`, recalculés et confirmés depuis les `oklch` de
`tokens.css` : `border-default` sur `surface-1` donne **1,63:1** là où 1.4.11 exige 3:1, et il borde
chaque champ, select, bouton, tag et nœud non sélectionné ; `text-muted` sur `surface-3` donne
**4,03:1** là où 1.4.3 exige 4,5:1, et `surface-3` est précisément le fond qu'un nœud prend au
survol **et à la sélection** — interagir avec un nœud rend donc son texte moins lisible. Étendre
`test/tokens.test.ts` d'une assertion de contraste sur chaque paire documentée dans `DESIGN.md`,
pour que la rampe ne puisse plus régresser.

**C. `/impeccable polish packages/ui/src`** sur les cinq écarts du 2026-10-22, dont la critique
reclasse deux points : parmi les onze tokens inutilisés, `--keelson-edge-width` et
`--keelson-edge-width-strong` ne sont pas de l'hygiène — leur absence est la raison pour laquelle
chaque arête rend au gris d'origine de React Flow, hors système ; et `EdgeData.highlighted` n'est
pas du code mort mais le retour visuel de la sélection. S'y ajoutent `--text-2xs: 10px`
(`tokens.css:42`), sous le plancher de 11 px du détecteur, qui explique à lui seul 12 des 14
constats navigateur ; et `OriginBadge`, qui majuscule `.deploy-base` en `.DEPLOY-BASE` — une clé
YAML sensible à la casse, écrite par l'utilisateur — déborde de 28 px malgré `truncate`, et cache
dans un `title` la phrase qui fait tout son intérêt.

**D.** État « content unavailable » explicite et testé quand `sliceOpaque` reçoit une plage hors
bornes ou inversée.

**E.** `/impeccable document` pour réécrire `DESIGN.md` sur le monde corrigé, puis revue
indépendante par sous-agent du diff complet de la branche contre `specs/lots/l2.md`, vérification
finale (`bun install --frozen-lockfile && bun run check && bun run e2e` plus le smoke test Node),
merge `--no-ff` dans `main`, `bun run check` sur `main`, mise à jour de ce fichier. Puis **L2c**
(ADR 0002), puis L2b.
Blocage : aucun

| Lot | Statut | Merge |
|-----|--------|-------|
| L0 — socle du monorepo | TERMINÉ | `main` (branche `lot/l0-socle`, créée comme `main`) |
| L1 — `core` + `adapter-gitlab` | TERMINÉ | `2a48b5a` (`--no-ff`) |
| L2 — serveur, vue Pipeline, `keelson start` | EN COURS — étapes 0 à 8 et 10 faites | — |
| L2c — messages : `code` + `params`, anglais unique, `details` fusionné | À FAIRE — **avant L3** (ADR 0002) | — |
| L2b — résolution des `include` locaux | À FAIRE | — |
| L3 — taxonomie, catalogue, overlay OWASP | À FAIRE | — |
| L4 — toolchain | À FAIRE | — |
| L5 — propositions et insertion | À FAIRE | — |
| L6 — adaptateur GitHub Actions | À FAIRE | — |
| L7 — packaging open source | À FAIRE | — |
| L8 — flotte | À FAIRE | — |

## Journal

### 2026-10-21 — L2 — création du suivi, puis étapes 4 et 5

`specs/progress.md` et `specs/lots/l2.md` n'existaient pas : le premier est reconstruit depuis le
dépôt, le second écrit depuis le code livré, le lot ayant été piloté par prompts successifs sans son
document de cadrage. Commit `4a4ed95`.

**Divergence constatée** : aucune entre le dépôt et les rapports précédents. `DESIGN.md` est absent,
ce qui est conforme — il est écrit en fin de lot par `/impeccable document`, depuis le monde
construit, et non avant.

**Étape 4 — états** (commit `d288c81`, 22 tests). `Loading`, `NoCiFile`, `InvalidDocument`,
`DocumentRemoved`, `NoticeBar`, plus `EmptyState` partagé. `Loading` est un `role=status` poli.
`NoCiFile` nomme le dossier inspecté et le fichier attendu. `InvalidDocument` ne liste que les
diagnostics d'erreur et dit que le fichier reste intact sur disque. `NoticeBar` distingue la
conséquence de l'information : `stale` et `removed` sont des `role=alert`, `reloaded` un
`role=status` poli ; chaque variante est nommée par un mot autant que par la couleur.

**Étape 5 — édition** (commits `51a559c` et `45b4c70`, 82 tests). `drafts.ts` construit les
opérations sans React : script découpé ligne par ligne, valeurs par défaut d'un need non écrites,
champ d'environnement vide omis plutôt qu'écrit comme chaîne vide. `useHistoryShortcuts` gère
Ctrl/Cmd+Z et Ctrl/Cmd+Shift+Z, s'efface dans un champ de saisie pour ne pas voler l'annulation
native du navigateur, et devient inerte quand l'édition est désactivée. `ErrorBanner` affiche code et
message du serveur tels quels, et ne traite spécialement que `JOB_REFERENCED`, dont il liste les
référents. `JobEditor`, `NewJobForm` et `StageControls` couvrent toutes les actions du lot, chacune
opérable au clavier ; `disabled` coupe à la fois les contrôles et le chemin de soumission.

Commandes : `bun install --frozen-lockfile` → 133 installs / 203 packages, no changes.
`bun run check` → lint 210 fichiers 0 erreur, typecheck 0 erreur, **852 pass / 0 fail**, build
complet. `detect.mjs --json packages/ui/src` → 0 entrée à chaque étape.

**Dettes datées** : aucune ajoutée. **Écarts** : aucun nouveau, les cinq entrées de
`specs/ecarts.md` sont inchangées. **ADR** : aucun créé — toutes les décisions de ces deux étapes
étaient des choix locaux de composant, sans conséquence d'architecture à consigner.

Deux décisions d'accessibilité prises aux étapes précédentes et qui restent en vigueur :
`role="group"` plutôt que `<section aria-label>` pour les colonnes de stage et les blocs opaques,
afin de ne pas noyer la liste des landmarks (règle Biome `useSemanticElements` supprimée
ponctuellement avec sa raison, `<fieldset>` étant réservé aux contrôles de formulaire) ; et
l'élément de description `aria-describedby` placé en frère du bouton, jamais dedans, sous peine de
polluer son nom accessible.

### 2026-10-22 — L2 — étapes 6, 7, 8, 10 et début de 9

**Étape 6** (`eac1490`, 25 tests). `readToken` lit `?token=` puis l'efface par
`history.replaceState` en conservant les autres paramètres. `app.tsx` assemble tout, dépendances
injectables : les 18 tests pilotent un client et un abonnement factices et couvrent le chemin complet
d'une édition jusqu'au 409.

**Étape 7** (`73838c3`, 7 tests). `scripts/dev.ts` + proxy Vite. `changeOrigin` est indispensable :
il réécrit `Host` vers `127.0.0.1:5284`, qu'exige le contrôle de `Host`. Vérifié de bout en bout —
`/api/workspace` répond 200 par le proxy sans token côté client, 403 en direct sans token.

**Étape 8** (`ca33096`, 24 scénarios E2E sur le binaire buildé). Remplace `app.e2e.ts` ;
Playwright ne démarre plus de `webServer`, chaque test gère son propre binaire, et `bun run e2e`
builde d'abord. **Deux défauts de fond trouvés par ces tests** :

1. Le serveur n'appelait **jamais** `validate()` : seuls les diagnostics de parsing atteignaient
   l'UI, alors que `keelson validate` combine les deux familles. `UNKNOWN_NEED`, `NEEDS_CYCLE`,
   `UNKNOWN_STAGE` et `NEED_LATER_STAGE` étaient invisibles dans le panneau. Corrigé dans le store
   du serveur, au chargement comme en réponse d'opération, avec 6 tests.
2. Ce correctif a exposé un défaut de conception : `canEdit()` se bloquait sur **toute** erreur, donc
   un `needs` vers un job inexistant rendait l'outil inutilisable pour corriger ce même `needs`. Le
   verrou porte désormais sur `INVALID_YAML` seul, via `blocksEditing()`. **ADR 0001.**

**Étape 10** (`b48a349`). `specs/01-plan.md` décrit l'API, les quatre garanties d'écriture et le
modèle de sécurité avec la raison de chaque mesure. `CLAUDE.md` décrit `bun run dev`.

**Début d'étape 9** (`0e95e68`). Captures desktop et mobile produites, puis **deux défauts corrigés
que seule l'inspection visuelle pouvait montrer**, tous les tests unitaires passant : les nœuds de
job étaient placés à `y=0` dans leur colonne, donc exactement sous l'en-tête, qu'ils recouvraient ;
et le panneau de diagnostics occupait un quart fixe de la hauteur pour afficher « No diagnostics ».

Commandes : `bun run check` → lint 218 fichiers 0 erreur, typecheck 0 erreur, **894 pass / 0 fail**.
`bun run e2e` → **24 passed**. `detect.mjs` → 0 entrée.

**ADR** : `specs/adr/0001-ce-qui-interdit-l-edition.md`. **Dettes datées** : aucune ajoutée.
**Écarts** : trois ajoutés le 2026-10-22 (recadrage du graphe, barre latérale sans regroupement,
passes `critique` et `audit` non exécutées).

### 2026-10-22 — L2 — étape 9 : passe `critique`

Vérification de reprise d'abord : arbre propre, branche `lot/l2-pipeline-ui` à `10b85d8`,
`bun run check` vert (lint 0, typecheck 0, **894 pass / 0 fail**, build complet). Aucune divergence
entre `progress.md` et le dépôt. Captures régénérées par
`bunx playwright test packages/ui/e2e/shots.e2e.ts` — à taille d'octets identique, donc le front
n'avait pas bougé.

`/impeccable critique packages/ui/src` exécutée **en mode double sous-agent**, comme l'exige son
invariant : A, revue de design non ancrée, et B, détecteur et preuve navigateur, isolées l'une de
l'autre. Pas de bannière de dégradation. Rapport persisté dans
`packages/ui/.impeccable/critique/2026-10-22T10-21-57Z__packages-ui-src.md`. **Score 20/40**,
3 P0 et 2 P1. Première exécution pour cette cible, donc pas de tendance.

**L'entretien de fin de `critique` n'a pas été lancé**, et c'est une substitution déclarée au titre
de la directive `AUTONOMY_DIRECTIVE_CHECK` d'Impeccable : les trois réponses qu'il demande —
priorité, intention tonale, périmètre — sont déjà écrites et ne se rouvrent pas. Le périmètre vient
de ce fichier, l'intention tonale du surface brief, la priorité de l'ordre des lots.

**Ce que le détecteur dit, et ce qu'il ne dit pas.** `detect.mjs --json packages/ui/src` rend 0 sur
41 fichiers. B a refusé de prendre ce zéro pour argent comptant et l'a étayé : extensions bien dans
le périmètre, aucune règle ignorée, et un fichier témoin de synthèse qui fait bien sortir le
détecteur en 2. Le moteur statique ne couvre que ~5 des 59 règles sur du source ; les 54 autres sont
des règles navigateur. **C'est là qu'était tout le signal : 14 constats en page, aux deux
viewports**, dont 12 remontent à un seul `--text-2xs: 10px` sous le plancher de 11 px. Deux faux
positifs écartés avec leur raison : `overused-font: roboto` est un artefact de cette machine Linux
sans police antérieure dans la pile système, et `clipped-overflow-container` appartient à la feuille
de style de `@xyflow/react`, qui doit rogner son viewport pour fonctionner.

**Trois défauts P0, tous vérifiés sur pièces avant d'être acceptés** — un sous-agent peut se
tromper, et ces constats commandent la fin du lot :

1. **La vue Pipeline affiche un job dans la mauvaise colonne.** Lu directement sur
   `review/desktop.png` : en-tête `build` « 1 job », deux cartes dedans, dont `lint` sous-titré
   `test`. C'est la seule chose que cette vue existe pour dire, et elle la dit faux, sur la fixture
   de dev du projet, avec `layout.test.ts` et `graph.test.ts` verts. Ces tests vérifient que la mise
   en page est *calculée*, jamais qu'elle est *vraie*.
2. **`JobEditor` sans `key`** : vérifié dans `app.tsx` et `JobEditor.tsx`. L'état local survit au
   changement de sélection, donc `Rename` peut écrire dans le YAML un nom que l'utilisateur n'a
   jamais tapé.
3. **Boucle d'écriture muette** : `dismissNotice()` ne remet que `notice` à `null` — le bouton
   `Dismiss` de la bannière d'erreur est mort, vérifié ligne à ligne ; `grep pending src/ --include=*.tsx`
   ne rend **aucune** ligne, alors que le store le maintient ; `touched` arrive dans `client.ts` et
   n'est lu nulle part.

L'arithmétique de contraste de A a été refaite indépendamment en reconvertissant les `oklch` en
luminance relative : `border-default` sur `surface-1` à **1,63:1** et `text-muted` sur `surface-3` à
**4,03:1**, au centième près des chiffres annoncés. Les deux manquent à l'engagement WCAG 2.1 AA de
`PRODUCT.md`.

**ADR créé : `0003-ce-qu-une-revue-rouvre-dans-un-lot.md`.** La règle « hors périmètre → écart »,
prise à la lettre, aurait permis de fusionner L2 en sachant sa vue principale fausse. L'ADR tranche
par nature de défaut et non par date de découverte : rouvre le lot ce qui fait qu'une étape livrée
ne tient pas ce qu'elle annonçait ; part en écart toute surface d'interaction nouvelle, qui exige
une passe `shape`. En une phrase : *une revue peut rouvrir une promesse, jamais en ajouter une.*

**Écarts** : sept ajoutés, tous de la catégorie « surface nouvelle » ou « hors L2 » — modèle clavier
du graphe, diff après écriture, recherche et palette, posture de lecture pour l'architecte sécurité,
indicateur de pipeline partiel (rattaché à L2b), template en colonne fantôme, et la non-reproductibilité
binaire des captures de revue, qui salit l'arbre à chaque passe et arrêterait la boucle de pilotage.

**Dettes datées** : aucune ajoutée. **Divergence** : aucune.

Le constat le plus dérangeant de la passe n'est pas visuel. `EdgeData.highlighted` et `pending` sont
tous deux modélisés, testés unitairement, et invisibles à l'écran. La frontière des tests s'arrête au
store et ne franchit jamais le rendu — ce qui est exactement comment une colonne peut dessiner le
mauvais job sans qu'un test rougisse.
