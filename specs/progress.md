# Suivi des lots

Statut : EN COURS
Lot courant : **L6 — adaptateur GitHub Actions**, à cadrer depuis `main`
Prochaine action : cadrage de L6, `specs/lots/l6.md`, branche `lot/l6-github`.
Blocage : aucun


| Lot | Statut | Merge |
|-----|--------|-------|
| L0 — socle du monorepo | TERMINÉ | `main` (branche `lot/l0-socle`, créée comme `main`) |
| L1 — `core` + `adapter-gitlab` | TERMINÉ | `2a48b5a` (`--no-ff`) |
| L2 — serveur, vue Pipeline, `keelson start` | TERMINÉ | `894464c` (`--no-ff`) |
| L2c — messages : `code` + `params`, anglais unique, `details` fusionné | TERMINÉ | `82bcb79` (`--no-ff`) |
| L2b — résolution des `include` locaux, origine par fichier, écriture bornée | TERMINÉ | `5a5b530` (`--no-ff`) |
| L2b-fix — preuves rouges, sévérité, texte d'aide, polish | TERMINÉ | `a88faf2` (`--no-ff`) |
| L3 — taxonomie, catalogue, overlay OWASP | TERMINÉ | `36caaa1` (`--no-ff`) |
| L4 — toolchain | TERMINÉ | `fd63570` (`--no-ff`) |
| L5 — propositions et insertion | TERMINÉ | `971ae5b` (`--no-ff`) |
| L6 — adaptateur GitHub Actions | **LOT COURANT** | — |
| L7 — packaging open source | À FAIRE | — |
| L8 — flotte | TERMINÉ | branche `worktree-agent-a2e944e08d1f71c15`, non fusionnée |

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

### 2026-10-23 — L2b — le lot complet

Vérification de reprise : arbre propre, `main` à `c1c15e4`, `bun run check` vert
(**1044 pass / 0 fail**). Aucune divergence entre `progress.md` et le dépôt.

**Étape 0 — cadrage avant toute ligne de code** (`a5dc9e5`). `specs/lots/l2b.md` recense la
sémantique d'`include` de GitLab **vérifiée sur la documentation officielle**, citation par
citation : chemin depuis la racine du dépôt, extensions `.yml`/`.yaml`, jokers `*` et `**`, ordre de
fusion, précédence du dernier inclus, non-dédoublonnage, limite de 150 fichiers. Neuf décisions de
cadrage, les dix sites qui produisent un diagnostic, et l'arborescence des tests.

**Une divergence assumée de l'énoncé.** Il demande « détection de cycle et **profondeur maximale**,
chacune avec son code ». GitLab ne documente aucune limite de profondeur de nid : il documente un
**compte total** de 150 fichiers inclus. Inventer une profondeur rendrait Keelson plus strict que sa
cible — exactement le défaut déjà consigné en écart pour `MAX_EXTENDS_DEPTH`. Le lot livre donc
`INCLUDE_CYCLE`, qui borne réellement la récursion, et `INCLUDE_LIMIT_EXCEEDED` sur le compte
documenté. Deux codes, chacun pour une borne qui existe.

**Deux ADR.** **0005** : le lecteur de fichiers est synchrone, parce que rendre `parse` asynchrone
contaminerait `apply` et toute la chaîne d'édition pour un gain nul, et parce qu'on ne peut pas
pré-lire ce qu'on découvre en lisant. **0006** : Keelson ne fabrique **jamais** de YAML fusionné —
la fusion est une chaîne ordonnée de définitions, celle qui résolvait déjà `extends` et les anchors.
Un document synthétique rendrait toutes les plages fausses sur disque et l'édition en place
impossible. C'est de là que vient le `file` porté par chaque élément de l'IR et par chaque
diagnostic : avec plusieurs textes, une plage sans fichier ne situe plus rien.

**Étapes 1 à 6** (`2d8a159`, `e2ea010`, `6e5b427`, `bc1fa39`, `a97bd8c`, `d29a10c`). L'ordre de
fusion de GitLab tombe gratuitement de l'ADR 0006 : il suffit de ranger les définitions dans le bon
ordre et de laisser `matches(...).at(-1)` faire le reste. `FROM_INCLUDED_FILE` refuse six opérations
sur un job inclus, `addStage` et `moveStage` quand la liste vient d'un include, et `renameJob`
quand un job inclus a besoin de l'ancien nom. **Deux défauts silencieux** que ces refus empêchent :
`addStage` matérialisait une liste de stages par défaut dans le fichier principal, écrasant celle de
l'include sans rien dire ; et `addJob` sur un nom venu d'un include aurait écrit une surcharge
partielle héritant silencieusement de ses clés.

**Un défaut trouvé par l'E2E et par lui seul** : `documentLoaded` et le rechargement posaient `text`
sans poser `included`, donc le panneau affichait « Content unavailable » sur un bloc parfaitement
lisible. Même classe que l'`applyPayload` du lot L2 — un champ d'état mis à jour sur un seul des
trois chemins qui l'alimentent.

**Les textes des fichiers inclus voyagent dans la charge du document**, et non derrière la route
`GET /api/includes/:file` que le cadrage annonçait. Trois raisons, écrites dans le cadrage corrigé :
les plages des blocs opaques sont des offsets dans ces textes et une route séparée les laisserait se
désaligner entre deux requêtes ; une seconde surface de lecture du disque serait une seconde
frontière à borner ; et le client ne peut pas demander un fichier hors de la résolution, puisqu'il
ne demande rien.

**Étape 7 — trois passes indépendantes**, toutes trois en lecture seule : une revue du lot par un
sous-agent qui n'avait pas vu l'implémentation, dans un worktree isolé, et les deux sous-agents de
`/impeccable critique` et `audit`. Dépôt vérifié intact au retour, aucun worktree résiduel. Elles
ont rendu **dix constats rouvrants**, tous vérifiés sur pièces avant d'être acceptés.

**Le pire du lot, et il est de sécurité.** Les deux contrôles de frontière du lecteur étaient
**lexicaux**, donc aveugles aux liens symboliques : `ci/fuite.yml → /etc/passwd` passait les deux, et
le contenu du fichier visé partait dans la charge envoyée au navigateur, sans le moindre
diagnostic. L'extension `.yml` était par ailleurs contrôlée sur le **nom du lien**, jamais sur sa
cible. Ouvrir Keelson sur un dépôt cloné depuis un tiers suffisait à exfiltrer n'importe quel
fichier lisible par l'utilisateur. Et mon commentaire affirmait au même endroit que ce contrôle
était « la dernière ligne avant un `readFileSync` […] lu par un serveur qui répond à une page web ».
Corrigé par `realpathSync` avant le contrôle de préfixe ; un lien reste permis s'il reste sous la
racine, parce qu'un dépôt peut légitimement en contenir et que seule la cible décide.

**Le plus humiliant est un défaut que j'avais corrigé, et détruit moi-même.** Les blocs opaques d'un
job surchargé étaient pris sur la seule définition propriétaire, donc un job défini dans un include
et redéfini dans le fichier principal perdait à l'écran son `script` et ses `artifacts`. J'avais
écrit le correctif, vérifié son effet, puis **l'une de mes restaurations de fichier pendant une
vérification rouge l'a effacé sans bruit** — `git checkout-index` restaure l'index, et à ce moment
l'index était antérieur au correctif. La régénération des goldens a ensuite **béni la régression** :
le golden `override` figeait `"opaque": []`. La revue l'a trouvé en lisant le golden commité au lieu
de me croire. Leçon tirée dans la pratique : après une série de mutations de vérification, relire le
**diff des goldens** et pas seulement l'état des tests.

**Un troisième constat de justesse** : un `extends` écrit dans le fichier principal battait une
valeur écrite **directement** dans la définition de l'include, parce que les sources du template
arrivaient après la map de l'include. GitLab ne résout `extends` qu'après la fusion, sur le job
fusionné : les clés propres d'un job battent toujours ses templates. La vue Pipeline plaçait donc le
job dans la mauvaise colonne — la classe de défaut exacte qui a motivé l'ADR 0003.

**Le P0 de la passe `critique`, trouvé sur mon propre golden** : `isPartial()` était **faux** quand
un include local était cassé, c'est-à-dire sur le défaut le plus courant d'un dépôt réel — une faute
de frappe dans un chemin. La bande de pipeline partiel ne s'affichait pas, et l'écran laissait croire
le pipeline complet alors qu'il lui manquait tout ce que ce fichier apportait. L'écart que je venais
de clore prétendait le contraire. Un include local cassé est désormais **deux** choses : une erreur
à corriger, et un trou dans le pipeline affiché.

**Tests trouvés incapables d'échouer sur ce lot : cinq. Trois par la revue, deux par moi.**
1. L'assertion de plage de `includes.test.ts` était un ternaire qui rendait la chaîne attendue dès
   que la plage existait — elle ne lisait **aucun octet**, et son commentaire la présentait comme la
   gardienne d'un offset. Cause : *une assertion contrainte par autre chose que ce qu'elle prétend
   mesurer*.
2 et 3. Deux tests annoncés comme « la mesure sur les **octets** du disque » appelaient `apply`, qui
   est une fonction **pure** : relire un fichier après un appel sans effet de bord est une
   tautologie. La revue l'a prouvé en neutralisant tous les refus `FROM_INCLUDED_FILE` sans faire
   rougir ni l'un ni l'autre. Cause : *un commentaire qui surestime ce qui protège*. Ils mesurent
   désormais que le résultat ne prétend rien avoir changé ailleurs, et la mesure sur les octets vit
   dans le test serveur, où une écriture a lieu.
4 et 5. Deux des trois tests écrits pour couvrir le défaut trouvé par l'E2E : le texte inclus était
   identique avant et après, donc ne pas reposer `included` laissait en place la valeur du premier
   chargement. Cause : *une fixture qui ne reproduit pas la forme du défaut*. Trouvés par moi, en
   vérifiant rouge.

Un sixième test a été corrigé sans être inerte : le test clavier du résumé ne prouvait que la
focalisabilité, `happy-dom` n'implémentant pas le basculement natif de `<details>`. Le dépliage est
vérifié sur le vrai navigateur, et le commentaire du test unitaire dit maintenant ce qu'il mesure.

**Le garde qu'une passe a rendu nécessaire.** `DESIGN.md` énonce que `border-subtle` n'est
**jamais** une limite de composant, et L2b venait de l'employer comme bordure d'un nœud de job —
mesurée à 1,26:1 contre sa colonne, donc un objet qui ne se lit plus comme un objet. Le garde de
1.4.11 ne pouvait pas l'attraper, puisqu'il ne teste que `border-default` et `accent` précisément
parce que `DESIGN.md` jurait que le cas n'existait pas. Le garde ajouté mesure l'**usage** et non le
contraste : `border-subtle` ne vaut qu'avec une arête nommée. Il a trouvé **trois violations
antérieures au lot**, toutes des cartes à 1,26:1, corrigées. Une seule exception, nommée : une
colonne de stage est un fond, pas un composant, et lui donner `border-default` ferait concurrencer
le conteneur à son contenu.

**Ce que l'`audit` a mesuré et n'a pas trouvé**, ce qui est aussi une information : zéro échec de
contraste sur **80 textes**, tous états compris, minimum réel 4,72:1 ; zéro violation du plancher de
11 px ; zéro défilement horizontal du `body` à 375 comme à 1280 ; zéro nom accessible vide ou
dupliqué ; zéro piège ni arrêt fantôme au clavier. Sa conversion `oklch` → sRGB a été confrontée à
celle de Chromium : écart nul sur les neuf tokens. Score `critique` : **28/40**, contre 20/40 au
2026-10-22.

**Écarts** : trois clos avec leur preuve — les `include` non résolus, l'indicateur de pipeline
partiel, la sévérité d'`EXTENDS_TARGET_NOT_FOUND` —, et **douze** nouveaux, dont la redite de
l'include non résolu sur deux surfaces, l'anneau de focus qui n'est en accent qu'à un seul endroit,
l'approximation `L³` du garde de contraste (optimiste pour les tokens chromatiques), et la fixture
de dev sans `include`, qui fait que `bun run dev` n'exerce aucune des trois surfaces livrées.

**Dettes datées** : aucune ajoutée. **Perte d'information assumée** : la fusion profonde de GitLab
n'est pas rendue sur les clés que l'IR ne modélise pas — deux fichiers qui définissent chacun une
partie d'un `artifacts:` affichent le bloc du dernier. L'ADR 0006 l'assume : la fusionner demanderait
de fabriquer le document synthétique que cette décision refuse.

Vérification finale depuis un arbre **sans aucun `dist/`, `types/` ni `*.tsbuildinfo`** :
`bun install --frozen-lockfile` (133 installs, no changes), `bun run check` → lint 247 fichiers
0 erreur, typecheck 0 erreur, **1199 pass / 0 fail**, build complet ; `bun run e2e` → **44 passed**
sur le binaire réel ; binaire exécuté sous `node v22.16.0` — il résout un arbre multi-fichiers et
nomme `ci/jobs.yml:6` pour un défaut qui y vit, et il **refuse** le lien symbolique qui sort de la
racine sans jamais en lire le contenu. `grep` : **0 ligne de français hors commentaire** dans
`packages/*/src`.

### 2026-11-04 — L2b-fix

**Pourquoi ce lot.** Le rapport de fin de L2b omettait quatre faits : `polish` n'avait pas tourné,
un include local cassé dégradait `EXTENDS_TARGET_NOT_FOUND` en warning, le texte d'aide du badge
était faux sur un job surchargé, et cinq correctifs post-revue n'avaient aucune preuve rouge. Le
journal précédent annonçait donc L2b terminé sur une base plus faible qu'il ne le disait.

**Méthode des preuves.** Script de mutation hors dépôt : défaut réintroduit, test lancé, fichier
restauré par réécriture, `git diff` vérifié vide sur ce fichier. Ni `git stash` ni
`git checkout-index`.

**Les cinq preuves demandées, toutes rouges** : lien symbolique (2 tests, deux mutations, et 1 test
de charge serveur ajouté, car aucun test ne gardait la charge elle-même) ; précédence d'`extends`
(1) ; `isPartial` (4) ; blocs opaques (2) ; texte d'aide (1, puis remplacé).

**Protections trouvées sans test en les sondant** : `Source file` conditionnel, badge retiré du nœud
inclus, note de verrou collante. Ces correctifs de L2b ne rougissaient rien. Tests ajoutés, prouvés
rouges, dont un E2E de géométrie pour `sticky`.

**Sévérité** (ADR 0007, décidé par Khalid). `error` pour un include local cassé, `warning` pour un
include qu'on n'a pas pu lire. `Pipeline.unresolved` ne décide plus de la sévérité.

**Texte d'aide.** Il dépend du job et de l'origine, trois phrases. Mon premier correctif ne regardait
que l'origine : il refusait une surcharge possible et en promettait une impossible sur un job inclus
hérité d'un `extends`. La promesse de surcharge est tenue par un test sur `apply`.

**`/impeccable polish`**, exécuté sur un arbre de stress, à 1280 et 375 px. Un vrai défaut : ma borne
de la bande partielle ne valait rien, 729 px sur 800 et 2751 px sur mobile avec 31 includes. Bornée
au tiers de l'écran. Aussi : bordure rouge de « Delete job » désactivé, filet sous la note collante,
graisse du tag, et la phrase « does not exist in this file », fausse depuis les includes.

**Revue indépendante : 5 constats rouvrants.** Tous reproduits par un test rouge avant correction.
- Le fichier principal lié hors racine sortait sans contrôle, par la voie que `reader.ts` ne couvrait
  pas : même exposition que le lien inclus, vérifiée sur le binaire. Il passe par le lecteur.
- Une URL en forme courte était un chemin local cassé. **Régression créée par ce lot** : la nouvelle
  règle la passait en `error`.
- `setJobStage` écrivait `stage: !reference test`.
- **Un `!reference` ne traversait pas les fichiers**, alors que la consigne de L2b l'exigeait et que
  son cadrage annonçait la fixture `reference-across/`, jamais créée. Mon commentaire présentait
  cette limite comme une règle de GitLab.
- Le texte d'aide n'avait de test que sur Stage.
Trois écarts corrigés au passage parce qu'ils contredisaient un commentaire ou une règle : ce que la
limite de 150 coupe rend le pipeline partiel (mon commentaire disait le fichier lu) ; une cible de
lien doit être du YAML ; la bordure de « Delete job » se vérifie sur le style calculé.

**Contre-revue du correctif : 3 constats rouvrants et 2 régressions de ce même correctif.**
`!reference` ne traversait ni alias ni clé de fusion et rendait la valeur perdante ; l'ordre était
faux pour un fichier inclus deux fois ; `setJobStage` échouait sur la forme en bloc ; le watcher se
taisait sur un fichier principal devenu lien refusé ; une FIFO figeait le démarrage. Corrigés et
prouvés rouges. Sans cette seconde passe, le lot fusionnait ces défauts.

**Tests trouvés incapables d'échouer : 6**, tous par les revues ou les sondes.
1. à 3. `Source file`, badge du nœud, `sticky` : aucun test. Cause : *un correctif de revue fusionné
   sans preuve rouge*.
4. et 5. Texte d'aide sur Needs et Environment. Cause : *une fixture qui ne couvre qu'une branche*.
6. Bordure de « Delete job » : assertion sur une chaîne de classe, remplacée par le style calculé.
   Cause : *une assertion qui mesure le source et non le rendu*.
Le faux négatif de mon script (`AUCUN ECHEC` affiché sur un test rouge, filtre trop strict) et un
test commité sur une base rouge par import manquant ont été corrigés avant toute conclusion : les
preuves concernées ont été refaites depuis une base verte.

**ADR** : 0007. **Dettes datées** : aucune. **Écarts** : 12 nouveaux, dont deux écritures fausses à
reprendre en tête de L3, et la ligne du 2026-10-20 sur les needs inter-projets corrigée, elle
affirmait que l'édition ne réécrit jamais la liste entière. `specs/pilote.md` complété.

**Ce qui reste volontairement non traité** : les formes rares de `setJobStage`, `keelson validate`
sans le lecteur, et `writeAtomic` à travers un lien interne, tous consignés.

Vérification finale depuis un arbre sans `dist/`, `types/` ni `*.tsbuildinfo` :
`bun install --frozen-lockfile` (133 installs, no changes), `bun run check` → lint 248 fichiers
0 erreur, typecheck 0 erreur, **1236 pass / 0 fail**, build complet ; `bun run e2e` → **46 passed** ;
`KEELSON_FC_RUNS=500` sur les propriétés → 18 pass ; binaire sous `node v22.16.0` : un include local
cassé rend `INCLUDE_NOT_FOUND` et `EXTENDS_TARGET_NOT_FOUND` en `error`, sur le bon fichier, exit 1.

### 2026-11-04 — L3

**Livré.** `@keelson/taxonomy` (13 couches OWASP, 8 catégories plateforme) ; `@keelson/catalog`
(62 fiches, compilées vers `catalog.json` commité, détection sur `image` et `script`, surcharge par
`.devsecops/layout.json`) ; `Job.signals` ; `/api/catalog`, `coverage` dans les charges,
`coverage.changed` ; vues Coverage et Catalog, posture de lecture, fiche outil ; `keelson coverage`
et `keelson catalog lint`. ADR 0008. Onze écarts clos au lot, chacun avec sa preuve dans
`specs/ecarts.md`.

**Revue indépendante.** Huit constats rouvrants, tous corrigés (`ecf83e4`). `critique` et `audit` :
un P0 (emphase invisible) et six P1, corrigés (`d22b63a`). Dix-sept preuves rouges ; seize tenues.

**Test incapable d'échouer.** « Un script global n'existe pas » n'avait pas de clé `script` de
premier niveau dans sa fixture : la mutation restait verte. Réécrit, prouvé rouge. Un test de
surcharge `__proto__` était inerte car zod retire la clé : supprimé, le code retiré avec lui.

**Limite de `catalog lint`.** Les 62 fiches portent `lastVerified: 2026-11-04` : la fraîcheur ne se
déclenche que sur des fixtures de test à `now` fixé, jamais sur le vrai catalogue avant mai 2027.

**`polish`.** Colonnes du catalogue nommées au défilement, E2E rouge puis vert.

**`document`.** `DESIGN.md` et son sidecar à jour, écart clos. La passe a relevé que la grille de
filtres contredisait l'ADR 0008 : corrigée sans point de rupture plutôt que d'élargir l'ADR.
Sections de `CoveragePanel` passées en groupes, licence seule en monospace. Les liens accent
`See tools` et `Homepage` sont acceptés dans l'Attention Accent Rule.

**Contre-revue des correctifs.** Quatre rouvertures :
1. `reloadCoverage` avalait `document.changed` et `document.removed`, régression de `ecf83e4` ;
2. une réponse périmée à `coverage.changed` écrasait la couverture d'une opération ;
3. `bash -c "trivy …"` et `(trivy …)` n'étaient plus détectés, régression de la même revue ;
4. l'image du snippet de ZAP n'était pas reconnue par sa propre fiche. Cause de fond gardée par un
   invariant sur tout le catalogue : chaque image de snippet GitLab est reconnue par sa fiche.

Traités aussi, parce que la valeur effective est une promesse de D1 : `inherit` et `image` fusionnés
à travers `extends`, job `trigger` sans signaux. Traités parce que faux : le message `partial` de la
CLI, le `file` de `COVERAGE_LAYER_MISSING`, la colonne Tool à 48 px à 375 px. Six mutations
rouges, `git diff` vide après chacune. Bornes de la détection shell et mineurs : `specs/ecarts.md`.

**Deuxième et troisième contre-revues, chacune sur le correctif de la précédente.** Le bilan dit
pourquoi la règle existe : `inherit` fusionné à tort à travers `<<` ; garde de `coverage.changed`
qui laissait un second onglet en retard ; `entryAt`, désormais appelé sur tous les jobs, qui
plantait sur `job: &a` + `<<: *a`, jusqu'à tuer le serveur sous Node ; fausse alerte et undo perdu
pendant une opération en vol ; puis rechargement dû oublié si cette opération échouait sans 409.
Chacun corrigé, prouvé rouge. Le watcher absorbe désormais les exceptions du parseur, et `entryAt`
partage son ensemble de maps visitées, ce qui rend les diamants linéaires. Les cycles qui lèvent
encore hors d'`entryAt` sont consignés.

**Cinquième et sixième contre-revues.** La cinquième a montré que le `catch` du watcher laissait le
store sur l'ancien texte : une opération remplaçait alors le fichier cassé. Le document illisible est
désormais oublié, opération en 500 sans écriture, deux tests prouvés rouges. La sixième, sur ce seul
changement et sur le binaire Node, ne rouvre rien.

**Une erreur de méthode.** Le passage en `role="group"` a été commité sans lancer le lint ; c'est la
vérification depuis un clone qui l'a attrapé. `bun run check` passe avant de considérer un correctif
terminé.

**Clôture.** Fusion `36caaa1`. Depuis un clone sans `dist/` : `bun run check` 1443 tests, propriétés à
500 runs, 56 E2E, smoke test Node (`validate`, `coverage`, `catalog lint`, `start`). `check` vert sur
`main`.

### 2026-11-05 — L4

**Livré.** Modèle et opérations de toolchain dans `core` ; `.devsecops/toolchain.yaml` lu, validé et
édité en place, quatre propriétés fast-check sur un corpus de douze fichiers ; champ `integration`
sur les fiches de service, propositions jamais écrites seules, `dismissed` ; couverture par service
déclaré ; positions dans `layout.json` ; routes `/api/toolchain`, `/api/toolchain/operations`,
`/api/layout/positions`, événement `toolchain.changed` ; `keelson validate` et `coverage` ; vue
Toolchain avec panneau, panneau de service et historique. ADR 0009 à 0011. Écarts clos : relecture
du disque avant écriture (y compris sur le CI), `scm` jamais couvert.

**Revue indépendante : le lot n'était pas fusionnable.** Dix constats, dont cinq écritures fausses
que des propriétés vertes à 500 runs ne voyaient pas :
1. un scalaire `|` ou `>` en fin de valeur faisait avaler la ligne suivante, donc un service ou une
   section entière ;
2. `services: ~` laissait `~` collé à la dernière valeur insérée ;
3. une mise à jour sur une ancre changeait ses alias ;
4. un fichier illisible valait un fichier vide, puis était écrasé ;
5. un lien interne était remplacé, un fichier non UTF-8 corrompu.

**Tests incapables d'échouer.** Les propriétés rendaient vert sur tout refus : une `applyToolchain`
qui refuse tout passait à 500 runs, et le corpus ne contenait ni bloc, ni `~`, ni ancre. Corrigé par
un corpus adverse et une liste fermée des refus attendus. `applyToolchain` relit désormais son
résultat contre un modèle calculé sans le texte, et refuse s'ils divergent : une forme de YAML
imprévue devient un refus, jamais une écriture fausse.

**Aussi.** `PUT` des positions fusionné plutôt que remplacé, corps JSON `null` qui laissait une
requête sans réponse sur les trois routes, trois courses du store.

**`critique` et `audit`.** Cinq P1 corrigés : Échap et focus, Retour arrière retirait un nœud de
l'écran, état invalide présenté comme vide, décisions invisibles sous `lg`, graphe illisible hors du
cas nominal, arêtes inatteignables au clavier (la liste des services les porte). Cette passe n'a pas
exécuté de navigateur : son cadre l'interdit. Les mesures de débordement à 320, 768 et 1024 px n'ont
donc pas été faites par elle ; l'E2E couvre 375 px.

**`polish`.** Captures à 1280 et 375 px après correctifs, sans constat nouveau.

**`document`.** Aucun token changé. `DESIGN.md` reçoit la vue Toolchain et le sens du pointillé.

**Une erreur de méthode.** Un commit de L4 (`ffeb4e3`) est parti avec un test en échec, parce que la
sortie a été lue après le `git commit`. Le suivant le corrige. L'enchaînement `bun test`, puis commit
seulement sur zéro échec.

**Contre-revues.** Cinq passes, chacune sur le commit de la précédente. Elles ont trouvé : l'écho d'une
écriture pris pour une modification externe sous `Ctrl+Z` tenu ; un `written` qui n'expirait jamais et
laissait l'écran faux ; un job disparu écrit quand même ; un focus volé en pleine saisie ; `8080:` et
`"8080":` qui faisaient écrire dans une entrée invisible. Tous prouvés rouges, E2E compris. La dernière
ne rouvre rien de bloquant, et son unique reste est consigné. Le premier essai de preuve de la garde de
focus n'avait pas de code de sortie fiable : refait avec un script qui rend celui de Playwright.

**Clôture.** Fusion `fd63570`. Depuis un clone sans `dist/` : `bun run check`, propriétés à 500 runs,
68 E2E, smoke test Node. `check` vert sur `main`.

### 2026-11-05 — L5

**Livré.** `addSnippet` et `composite` à inverse unique (ADR 0012), propriétés étendues ;
`POST /api/documents/:file/preview`, sans effet ; `Add to pipeline` dans la fiche outil, diff
sémantique avant écriture, couches couvertes, annulation d'un coup ; `keelson export`, `markdown`,
`mermaid`, `json`, documentés dans `specs/export.md` ; découpage shell de la détection. Écarts clos :
needs inter-projets, découpage du script.

**Laissés ouverts, avec leur raison.** Exécuter les snippets dans un conteneur : aucun runner ici.
Variantes `:debug` des quatre images : non vérifiées sur pièces. Analyseurs GitLab Secure : aucune
fiche ne les porte.

**`critique` et `audit`, cette fois avec un navigateur.** Un P0 : `scan_type="Trivy Scan"` dans le
snippet DefectDojo faisait compter SCA, IaC et Infrastructure, et `coverage --require sca` sortait en
0 sans aucun scanner. Corrigé, et gardé par un invariant sur tout le catalogue : un snippet ne
revendique que les couches de sa fiche. Sept P1 corrigés : diff tronqué, action principale illisible,
aucun retour après écriture, focus perdu, Undo couvert sous `lg`, échec d'écriture invisible, diff
sans sémantique.

**Un retour en arrière.** Le défilement des snippets, livré pour clore un écart, les rendait
inatteignables au clavier et contredisait `DESIGN.md` : retiré, écart rouvert.

**Revue indépendante.** Neuf rouvertures : `Insert` écrivait un nom que le diff ne montrait pas, la
preview avalait `document.changed` en avançant le hash, un snippet indenté s'écrivait dans le job
précédent, un `stage` vide donnait `test# c`, les needs inter-projets derrière une ancre restaient
perdus (l'écart avait été déclaré clos à tort), `addStage` recopiait une ancre, Mermaid perdait les
jobs d'un stage non déclaré et laissait passer `%%{init}%%`, et 6 Ko de `$(` faisaient planter la CLI.
Elle a aussi trouvé la cause de l'instabilité E2E : une assertion déjà vraie avant l'action.

**Trois erreurs de méthode.** `pkill -f` a tué mon propre shell, ce que le journal de L2b notait déjà.
Un premier correctif de `unmodelledNeeds` a marqué tous les jobs à `needs` : `entryAt` rend `null`
hors d'une map, et les goldens l'ont attrapé sans être régénérés.

La troisième : la preuve rouge de la borne du découpage shell bloquait, comme prévu, et son `timeout`
a tué le script avant la restauration. Le fichier muté est parti dans le commit de journal `5db58c3`
par `git add -A`, repéré à la relecture et corrigé au commit suivant. Une mutation qui peut ne pas
finir se lance sans `timeout` extérieur au script, et `git add -A` ne suit jamais une mutation sans
contrôle de l'arbre.

**Contre-revues.** Six passes. Les premières ont trouvé un formulaire bloqué après un 409, des faux
positifs et une explosion de regex introduits par le correctif du shell, puis une explosion du parcours
de `needs`. Le mot à mot a remplacé la regex, et une liste blanche a remplacé le parcours : seul ce que
l'IR rend à l'identique est réécrit, et la liste relue est comparée à la liste attendue. La dernière ne
rouvre rien.

**Clôture.** Fusion `971ae5b`. Depuis un clone sans `dist/` : `bun run check`, propriétés à 500 runs,
71 E2E, smoke test Node, `export` compris. `check` vert sur `main`.


### 2026-11-11 — L8 — `keelson apply`

Cadrage dans `specs/lots/l8.md`, écrit depuis `main` à `f044143`. L6 reste le lot courant, L7 à
faire : L8 a été mené en parallèle, sur une branche à part, parce qu'il ne touche que la CLI.

**Livré.** `keelson apply <ops.json> [<dépôt>...] [--file] [--rebase] [--dry-run] [--json]`. Le
fichier d'opérations est validé en entier par `parseOperation` avant le premier dépôt : un JSON
illisible, un tableau vide ou une opération invalide sortent en 2, l'index nommé
(`operations[1]: …`), le texte rendu par `@keelson/core/messages`. Chaque dépôt est traité seul : la
séquence s'applique en mémoire, chaque opération sur le `document` rendu par la précédente, et le
fichier n'est écrit qu'une fois, par `writeInsideRoot` (désormais exporté par `@keelson/server`),
si toute la séquence aboutit. `--rebase` réancre chaque `baseHash` sur le texte courant ; sans lui,
un dépôt dont le texte diffère rend `STALE_DOCUMENT` et les autres sont écrits. `--dry-run` rend
`+n -m line(s)`, le nouveau hash et un diff `-U0`. `--json` rend `{ results: [...] }`, avec `code`,
`params`, `kind` et l'index pour une erreur d'opération.

**Frontière.** Le fichier visé est lu par `readInsideRoot` : un `--file ../x` et un lien vers
l'extérieur sont refusés sans lecture ni écriture, deux tests. Les `include` passent par
`createFileReader` sur la racine du dépôt : un `removeJob` sur un job inclus rend
`FROM_INCLUDED_FILE`, pas `JOB_NOT_FOUND`.

**TDD.** `packages/cli/test/apply.test.ts` et les listes de commandes de `run.test.ts` écrits
d'abord : 30 échecs sur 41 avant toute implémentation. Le test à deux blocs du diff, ajouté après,
est prouvé par mutation. Deux mutations après coup : le `--rebase` retiré fait tomber 1 test, la
numérotation des blocs du diff en fait tomber 3. Arbre restauré et vérifié après chacune.

**Commandes.** `bun run lint` et `bun run typecheck` : 0 erreur. `bun test packages/cli` : vert
hors `sert le bundle d'UI embarqué`, qui exige `dist/ui` et passe sous `bun run check`.
`bun run check` : **1803 pass / 4 fail**, les quatre échecs étant les tests `chmod` du serveur,
préexistants, qui échouent parce que le conteneur tourne en root.

**Écarts.** Quatre, du 2026-11-11 : `baseHash` encore exigé sous `--rebase`, deux diffs de même
algorithme, aucune relecture du disque avant le `rename`, GitLab seul. **Dettes datées** : aucune.
**ADR** : aucun, les décisions de forme sont dans le cadrage.
