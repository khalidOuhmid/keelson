# Suivi des lots

Statut : EN COURS
Lot courant : **L2b — résolution des `include` locaux**, à cadrer depuis `main`
Prochaine action : créer la branche `lot/l2b-includes` depuis `main`, puis écrire
`specs/lots/l2b.md` avant de coder. Deux points déjà fixés par des écarts du 2026-10-22 :
l'indicateur de **pipeline partiel** dans l'UI, avec le diagnostic `INCLUDE_UNRESOLVED` remonté
jusqu'à l'écran, et le fait que `EXTENDS_TARGET_NOT_FOUND` est aujourd'hui dégradé en avertissement
*parce que* les `include` ne sont pas résolus — la résolution doit donc lui rendre sa sévérité
d'erreur quand plus rien ne manque.
Blocage : aucun


| Lot | Statut | Merge |
|-----|--------|-------|
| L0 — socle du monorepo | TERMINÉ | `main` (branche `lot/l0-socle`, créée comme `main`) |
| L1 — `core` + `adapter-gitlab` | TERMINÉ | `2a48b5a` (`--no-ff`) |
| L2 — serveur, vue Pipeline, `keelson start` | TERMINÉ | `894464c` (`--no-ff`) |
| L2c — messages : `code` + `params`, anglais unique, `details` fusionné | TERMINÉ | `MERGE_L2C` (`--no-ff`) |
| L2b — résolution des `include` locaux | **LOT COURANT** | — |
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

### 2026-10-22 — L2 — étape 9 : correctifs A1 et A2

**A1 — `df96b19`.** Le test d'invariant exigé par l'ADR 0003 a échoué du premier coup sur `lint`, le
job sans arête, exactement comme la capture le montrait ; les trois autres scénarios passaient. La
partition devient autoritaire : `x` vient de l'index de la colonne, elkjs ne décide plus que `y`.

Ce correctif en créait un autre, et c'est le second invariant qui l'a attrapé : forcer le `x` ramène
dans une même colonne des nœuds qu'elkjs avait séparés en couches, donc au même `y`, et deux jobs
isolés se recouvraient. Résolu en conservant l'ordre d'elkjs et en décalant vers le bas. La hauteur
du graphe est recalculée depuis les nœuds, que ce décalage peut faire descendre sous celle d'elkjs.
Capture régénérée et relue : `lint` est dans `test`, qui annonce « 2 jobs » et en contient deux.

**A2 — `51b43f5`.** Le test a rendu `Expected: "unit", Received: "compile"` — le défaut exact.
Corrigé par `key={selected.id}`. Deux pièges rencontrés en écrivant le test, tous deux dans le test
et non dans le code : `getByRole` synchrone juste après le rendu, là où les tests existants
attendent le nœud par `findByRole` ; et le sélecteur `/job id/i`, qui attrape aussi « New job id »
de la barre de gauche et rendait « Found multiple elements ». Nom exact depuis.

Ajouté dans la foulée, même famille : les champs d'environnement s'initialisaient à vide même quand
le job en portait un, de sorte que le panneau affichait `name: production` au-dessus de deux champs
vides.

`bun run check` → lint 0, typecheck 0, **904 pass / 0 fail**, build complet. Arbre propre.
**ADR** : aucun nouveau. **Dettes datées** : aucune. **Écarts** : aucun nouveau.

### 2026-10-22 — L2 — deux règles de test ajoutées par Khalid

Deux règles non négociables inscrites dans `CLAUDE.md` et dans le prompt de pilotage, en réponse
directe au constat de fin de passe `critique` :

- **frontière de test du rendu** : tout état ou donnée calculée pour l'UI doit avoir au moins un
  test de son effet dans le DOM rendu ou en E2E, pas seulement de sa valeur ; un champ calculé sans
  consommateur à l'écran est soit branché, soit supprimé ;
- **invariants de mise en page** : la cohérence entre l'IR et l'affichage se teste sur le rendu et
  en E2E, pas uniquement sur les coordonnées calculées.

Elles rendaient **insuffisants les deux invariants écrits plus tôt dans la journée**, qui ne
vérifiaient que des coordonnées. Ajoutés donc, commit `de19d2e` :

- deux tests sur le DOM rendu dans `app.test.tsx` — chaque job tombe dans la colonne du stage qu'il
  **annonce**, et le compte de l'en-tête égale le nombre de jobs rendus dans la colonne ;
- un test E2E sur le binaire réel et la fixture de dev, qui ajoute la non-superposition verticale.

Deux pièges méritent d'être consignés, parce qu'ils auraient produit des tests verts sans valeur.
**Premier** : le pipeline du harnais est entièrement fait d'arêtes et ne reproduit donc pas la forme
du défaut — un job *sans* arête dans un stage tardif. Les tests passaient par construction. Un job
orphelin a été ajouté à la fixture de test. **Second** : la première version du test de confinement
vérifiait « dans exactement une colonne » et non « dans **sa** colonne » ; elle restait verte avec
le défaut d'origine remis, puisqu'un job mal placé est quand même dans *une* colonne.

Les deux versions ont été **vérifiées rouges** en remettant temporairement le placement d'origine
dans `layout.ts`, puis le fichier a été restauré à l'identique du commit (`git diff` vide). Le stage
est lu dans la description accessible du nœud, pas dans l'IR : l'invariant compare l'affichage à
lui-même, et non le calcul à lui-même.

`bun run check` → **906 pass / 0 fail**. `bunx playwright test pipeline.e2e.ts` → 12 passed.

Conséquence sur la suite : l'item A4 (`pending`) et le reclassement d'`EdgeData.highlighted` en
item C ne sont plus optionnels. Les deux champs sont calculés, testés et invisibles ; la règle
impose de les brancher avec un test sur le DOM, ou de les supprimer.

SESSION TERMINÉE — reprendre avec le même prompt

### 2026-10-22 — L2 — clôture du lot

Deux revues indépendantes successives, par des sous-agents n'ayant pas vu l'implémentation.

**La première** a rendu un constat disqualifiant : `applyPayload` ne rafraîchissait jamais `text`,
alors que les plages des blocs opaques viennent du nouveau pipeline. Après toute édition décalant
des offsets, le visualiseur affichait un fragment chevauchant la clé d'un autre job — sur la seule
surface dont la garantie écrite est « ceci est intact ». Le watcher taisant les écritures propres du
serveur, aucun rechargement ne le réparait jamais. Elle a aussi prouvé que **deux tests E2E ne
pouvaient pas échouer**, et que `bun run check` était rouge sur un clone neuf, l'ordre `test` avant
`build` ne passant ici que grâce à un `dist/ui` rémanent.

**La seconde**, strictement en lecture seule dans un worktree isolé, a trouvé que `JobEditor`
pouvait encore soumettre un job que l'utilisateur n'avait pas choisi — même classe que le montage
sans `key`, le sélecteur de need affichant une cible pendant que l'état en gardait une autre — et
que deux correctifs de la première n'avaient aucun test capable d'échouer. Le dépôt est ressorti
intact : même `HEAD`, même nombre de commits, arbre propre, aucun worktree résiduel.

**Quatre ADR** sur le lot : 0001 (ce qui interdit l'édition), 0002 (langue et messages), 0003 (ce
qu'une revue rouvre dans un lot), 0004 (aucune écriture sans geste explicite).

**La leçon la plus coûteuse** : sur l'ensemble du lot, **sept tests se sont révélés incapables
d'échouer** — trois trouvés par moi, deux par la première revue, deux par la seconde. Tous étaient
verts, tous paraissaient couvrir leur sujet. Les causes se répètent : une fixture qui ne reproduit
pas la *forme* du défaut, une assertion contrainte par autre chose que ce qu'elle prétend mesurer,
et une lecture qui gagne la course contre l'écriture qu'elle devait interdire. D'où la pratique
retenue pour la suite : **tout correctif se vérifie rouge en réintroduisant le défaut réel**, sans
`git stash`, le fichier restauré par réécriture et le `git diff` vérifié vide.

Vérification finale depuis un arbre sans aucun `dist/` : `bun install --frozen-lockfile` puis
`bun run check` → **1011 pass / 0 fail** ; `bun run e2e` → **35 verts** ; binaire buildé exécuté
sous `node`. Merge `--no-ff` dans `main` (`894464c`), `bun run check` vert sur `main`.

### 2026-10-22 — L2c — le lot complet

Vérification de reprise : arbre propre, `main` à `b8106c2` (après `894464c`), `bun run check` vert
(**1011 pass / 0 fail**). Aucune divergence entre `progress.md` et le dépôt.

**Étape 0 — inventaire avant toute ligne de code** (`cecfa4c`). `specs/lots/l2c.md` recense les 9
diagnostics, les 13 erreurs d'opération, les **6 codes de transport du serveur** — non documentés,
non déclarés comme constantes, écrits en littéral à chaque site — et les 44 appels à `fail()` de
`apply.ts`, avec fichier et ligne. Deux complétions du périmètre y sont consignées, pas des
contradictions : la **chrome de la CLI** (usage, aide, « aucun diagnostic ») est en français mais ne
porte aucun code, donc elle est traduite sur place et n'entre pas au registre ; et les six codes de
transport entrent au registre, sans quoi l'UI ne peut pas les rendre et le test d'exhaustivité
aurait son trou exactement là où était le français.

**Une divergence de l'énoncé, consignée et non suivie à la lettre** : il demande un E2E sur « un 409
`JOB_REFERENCED` », que le serveur ne peut pas produire — le 409 est réservé à `STALE_DOCUMENT`,
`JOB_REFERENCED` sort en 422 (`store.ts`). L'intention étant sans ambiguïté, l'E2E emprunte le vrai
chemin : supprimer un job dont trois autres ont besoin.

**Sept décisions tranchées au cadrage**, toutes réversibles donc sans ADR. La principale : un
discriminant **`reason`** dans les `params` plutôt que treize codes nouveaux, pour `INVALID_OPERATION`
(8 situations), `RANGE_OUT_OF_BOUNDS` (9) et `NOT_FOUND` (5). Les codes sont un contrat public ; en
ajouter treize dépassait le périmètre. L'exhaustivité des branches est garantie **à la compilation**
par la forme de `en.ts` : un code à `reason` se rend par une table de branches, et sa forme à
l'exécution est ce que le test de couverture parcourt — les deux ne peuvent pas dériver.

**La seule divergence avec l'arborescence demandée** : `messages.test.ts` va dans
`packages/core/test/`, pas dans `src/messages/`. La contrainte de runtime Node de `CLAUDE.md`
l'impose — le `tsconfig` de `core` n'inclut que `src/` avec `"types": ["node"]`, et
`scripts/check-runtime.ts` échoue sur tout import `bun:*` dans un `src/` de package runtime.

**Étapes 1 à 5** (`5f8c9a2`, `f092a91`, `b214be5`, `d072046`, `12f934d`, `524a062`). `Diagnostic` et
`OperationError` deviennent des **unions discriminées** sur `code`, de sorte que le compilateur
refuse d'apparier un code et des `params` au hasard ; `renderMessage` accepte directement un
diagnostic ou une erreur, ce que `render(code, params)` seul ne permettait pas sans perdre la
corrélation. Le dédoublonnage de `resolve.ts`, qui portait sur le message, porte maintenant sur une
sérialisation à clés triées des `params` — sans cela deux cibles d'`extends` absentes différentes
auraient fusionné en un seul diagnostic. Le double calcul de hash du serveur est réduit à
`result.value.hash`.

**Un défaut trouvé par la migration elle-même** : `ErrorBanner` plantait sur un `JOB_REFERENCED`
dont les `params` ne portaient pas `referencedBy`. Le type l'exige, le fil ne le garantit pas, et
l'exception survenait **pendant l'affichage d'une autre erreur** — donc au pire moment.

**Étape 6 — revue indépendante**, en lecture seule dans un worktree isolé, par un sous-agent qui
n'avait pas vu l'implémentation. Dépôt vérifié intact au retour : même `HEAD`, 75 commits, arbre
propre, aucun worktree résiduel. Elle a rendu **trois constats qui rouvrent le lot et quatre
écarts**, tous vérifiés sur pièces.

**Le constat qui compte, et il est humiliant** : le correctif « `render()` ne lève jamais »
**annulait le test de couverture du même lot**. La revue a cassé `EXTENDS_CYCLE` — une faute de nom
de `params` — et obtenu **908 pass, 0 fail** : le `try/catch` changeait l'exception en phrase valide,
et les trois gardes « non vide, pas d'`undefined`, pas de français » étaient tous satisfaits par ce
repli. Une protection de production avait rendu inerte le test qui la surveillait. Corrigé en deux
temps : les fixtures portent désormais **le texte attendu de chaque branche**, et elles sont
exercées par `EN` **directement**, sans le repli.

Deuxième constat : `render()` pouvait rendre `undefined` contre son propre type, parce
qu'`INVALID_YAML` est le seul renderer dont le corps est une lecture de `params` nue — il ne levait
pas, il rendait la valeur absente, que la CLI passait ensuite à `.replace()`. Ne pas lever ne
suffisait donc pas : `render()` garantit maintenant une **phrase non vide**.

Troisième constat : trois chemins d'erreur du serveur n'étaient pas vérifiés, et **mon commentaire
affirmait le contraire** pour le 413 — en renvoyant vers « son describe », où seul le code était
testé. Or le 413 est le seul corps que le serveur sérialise à la main, hors du `fail()` qui garantit
la forme : c'était le chemin le moins gardé, décrit comme couvert. `INTERNAL_ERROR` n'était pas
testé non plus ; il l'est maintenant, en rendant le dossier du document non inscriptible pour faire
lever l'écriture atomique.

Quatrième constat retenu, classé rouvrant alors que la revue le donnait en écart :
`NEED_NOT_FOUND` rendait **une phrase fausse**. Les deux sites avaient fusionné sous un seul texte,
alors que le second n'est atteint qu'après avoir établi que le need *est* effectif — il vient d'un
alias d'anchor ou d'un `!reference`. La phrase disait l'inverse de la condition qui y mène, et aucun
test n'atteignait ce chemin. Deux fixtures l'atteignent maintenant, et le `reason` `notLocal` dit ce
qui se passe.

**Tests trouvés incapables d'échouer sur ce lot : trois**, tous les trois par la revue.
1. « chaque rendu est exercé » — absorbé par le repli de `render()`. Cause : *une assertion
   contrainte par autre chose que ce qu'elle prétend mesurer*, ici un filet de sécurité ajouté
   quinze minutes plus tôt dans le même lot.
2. les deux tests de conséquence de `hash.test.ts` — les deux expressions fusionnées rendaient la
   même valeur, donc aucun test de comportement ne pouvait rougir. Seul le garde structurel protège,
   et mon commentaire l'attribuait aux deux autres. Cause : *un commentaire qui surestime ce qui
   protège*. Le garde a par ailleurs été durci — il ne voyait que `hashText(`, pas le détour par
   `parse(…).hash` — et il retire désormais les commentaires du fichier avant de chercher, pour ne
   pas se déclencher sur sa propre explication.
3. le 413 et le bundle d'UI absent — seul le **code** était asserté, pas la forme, donc une clé
   `message` réapparue serait passée. Cause : *une fixture qui ne reproduit pas la forme du défaut*.

Chaque correctif a été **vérifié rouge en réintroduisant le défaut réel**, sans `git stash`, le
fichier restauré par réécriture et `git diff` vérifié vide : seize mutations au total, dont les deux
sens du garde de documentation, le dédoublonnage ramené au seul code, les quatre corps du serveur
avec une clé `message` remise, le `reason` de `NEED_NOT_FOUND` refusionné, et les trois assertions
E2E avec le rendu neutralisé.

**ADR** : aucun nouveau. L'ADR 0002 reçoit sa ligne de portée complétée ; l'ADR 0003 a servi deux
fois à trancher rouvre / écart.

**Écarts** : deux clos avec leur preuve (`@keelson/server` hors de l'ADR 0002, double calcul de
hash), deux nouveaux — le commentaire du test clavier de L2 qui surestime sa protection, et
l'absence de validation des `params` à la frontière réseau, qui laisse encore interpoler le mot
« undefined » dans une phrase lisible. Celui-ci part au lot L8, qui ouvre l'API à des clients
distants et en a le vrai besoin.

**Dettes datées** : aucune ajoutée. **Perte d'information assumée** : `parseOperation` n'expose plus
la liste complète des `issues` de zod, seulement `path` et `detail` du premier — porter les issues
dans `params` ferait dépendre un contrat public des internes de zod.

Vérification finale depuis un arbre **sans aucun `dist/` ni `types/`** : `bun install
--frozen-lockfile` (133 installs, no changes), `bun run check` → lint 226 fichiers 0 erreur,
typecheck 0 erreur, **1044 pass / 0 fail**, build complet ; `bun run e2e` → **35 passed** sur le
binaire réel ; binaire exécuté sous `node v22.16.0` — `validate` rend l'anglais, `--format json`
expose `params` **et** `message`, l'aide est en anglais. `grep` : **0 ligne de français hors
commentaire** dans `packages/*/src`.
