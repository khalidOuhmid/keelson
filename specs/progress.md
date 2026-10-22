# Suivi des lots

Statut : EN COURS
Lot courant : L2 — étape 6 : câblage de `app.tsx`
Prochaine action : écrire `packages/ui/test/app.test.tsx` puis réécrire `packages/ui/src/app.tsx`.
Tout ce dont `app.tsx` a besoin existe déjà et est testé ; il ne reste qu'à l'assembler.

1. Lire le token dans `window.location.search` (`?token=`), puis l'effacer de l'URL par
   `history.replaceState` sans recharger la page, pour qu'il ne reste ni dans la barre d'adresse ni
   dans l'historique. Garder le token en mémoire et le passer à `new KeelsonClient({ token })`
   (`src/api/client.ts`), qui l'envoie déjà en en-tête `X-Keelson-Token` sur chaque appel et
   l'ajoute en paramètre de requête pour `eventsUrl()`.
2. Créer le store par `createStore({ submit, document, newOpId })` (`src/state/store.ts`) en
   branchant `submit` et `document` sur le client, et `newOpId` sur `crypto.randomUUID()`.
3. Au montage : `client.workspace()`. Liste vide → `store.workspaceEmpty()`. Sinon
   `client.document(files[0].path)` → `store.documentLoaded(path, payload)`.
4. S'abonner par `subscribe(client.eventsUrl(), (event) => store.serverEvent(event))`
   (`src/api/events.ts`) et fermer l'abonnement au démontage.
5. Composer : `NoticeBar` et `ErrorBanner` en tête, `HistoryControls` dans la barre d'outils,
   `PipelineCanvas` au centre, `JobDetailPanel` + `JobEditor` à droite quand `selectedJobId` n'est
   pas nul, `StageControls` et `NewJobForm` dans la barre latérale, `DiagnosticsPanel` en bas avec
   `onSelectRange={store.selectByRange}`. Brancher `useHistoryShortcuts({ enabled: canEdit() })`.
   Aiguiller sur `status` : `loading` → `Loading`, `empty` → `NoCiFile`, `removed` →
   `DocumentRemoved`, et `canEdit() === false` par diagnostic d'erreur → `InvalidDocument`.
   Passer `disabled={!canEdit()}` à tous les formulaires d'édition.

Étapes suivantes, dans l'ordre, détaillées dans `specs/lots/l2.md` : 7 `scripts/dev.ts` et
`bun run dev` ; 8 les deux fichiers E2E ; 9 les passes Impeccable `critique`, `audit`, `polish`
puis `document` qui écrit `DESIGN.md` ; 10 docs (`specs/01-plan.md` pour l'API serveur et le modèle
de sécurité, `CLAUDE.md` pour `bun run dev`). Puis revue indépendante par sous-agent, vérification,
merge `--no-ff` dans `main`, et lot L2b.
Blocage : aucun

| Lot | Statut | Merge |
|-----|--------|-------|
| L0 — socle du monorepo | TERMINÉ | `main` (branche `lot/l0-socle`, créée comme `main`) |
| L1 — `core` + `adapter-gitlab` | TERMINÉ | `2a48b5a` (`--no-ff`) |
| L2 — serveur, vue Pipeline, `keelson start` | EN COURS — étapes 0 à 5 faites | — |
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
