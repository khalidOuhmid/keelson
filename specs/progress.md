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
