# Suivi des lots

Statut : EN COURS
Lot courant : L2 — étape 4 : états explicites de l'UI
Prochaine action : créer `packages/ui/src/states/` et ses tests dans `packages/ui/test/states/`.
Quatre états, tous déjà portés par le store (`packages/ui/src/state/store.ts`) : `status === "loading"`,
`status === "empty"` (aucun fichier CI détecté), `canEdit() === false` par présence d'un diagnostic de
sévérité `error` (YAML invalide : diagnostics affichés, édition désactivée), `status === "removed"`.
Afficher aussi `notice` et ses trois variantes `stale` / `reloaded` / `removed`. Puis étapes 5 à 10
de `specs/lots/l2.md`.
Blocage : aucun

| Lot | Statut | Merge |
|-----|--------|-------|
| L0 — socle du monorepo | TERMINÉ | `main` (branche `lot/l0-socle`, créée comme `main`) |
| L1 — `core` + `adapter-gitlab` | TERMINÉ | `2a48b5a` (`--no-ff`) |
| L2 — serveur, vue Pipeline, `keelson start` | EN COURS | — |
| L2b — résolution des `include` locaux | À FAIRE | — |
| L3 — taxonomie, catalogue, overlay OWASP | À FAIRE | — |
| L4 — toolchain | À FAIRE | — |
| L5 — propositions et insertion | À FAIRE | — |
| L6 — adaptateur GitHub Actions | À FAIRE | — |
| L7 — packaging open source | À FAIRE | — |
| L8 — flotte | À FAIRE | — |

## Journal

### 2026-10-21 — L2 — création du suivi

`specs/progress.md` n'existait pas : reconstruit depuis l'état réel du dépôt. `specs/lots/l2.md`
n'existait pas non plus — le lot L2 a été piloté par prompts successifs, sans le document de cadrage
que prévoit la boucle ; il est écrit maintenant à partir du code livré, pas des specs seules.

État vérifié : branche `lot/l2-pipeline-ui`, arbre propre, 6 commits d'avance sur `main`.
`bun install --frozen-lockfile` → 133 installs / 203 packages, no changes.
`bun run check` → lint 190 fichiers 0 erreur, typecheck 0 erreur, **746 pass / 0 fail**, build complet.

Divergence constatée : aucune entre le dépôt et les rapports des sessions précédentes. `DESIGN.md`
est absent, ce qui est conforme au flux Impeccable — il est écrit en fin de lot par `document`,
depuis le monde construit.

Livré sur la branche à ce jour : `@keelson/server` (9 modules, 96 tests), `keelson start` et
`args.ts` sur `parseArgs`, le client API et l'abonnement SSE, le store Zustand avec undo/redo,
`tokens.css` et son garde anti-valeurs en dur, la vue Pipeline (couche pure `graph.ts` + composants
xyflow, badges d'origine), les panneaux de détail et de diagnostics, et le correctif
`aria-describedby`.
