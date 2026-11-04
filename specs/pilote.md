# Pilote autonome — lots L3 à L8

Ce fichier est la consigne complète de l'agent jusqu'à la fin du projet. Il se relit à chaque session. L'état de reprise est dans `specs/progress.md`, jamais dans la conversation.

## Démarrage de session
1. Lis `specs/progress.md` et reprends à sa « Prochaine action ». Vérifie que l'état décrit correspond au dépôt (branche, derniers commits, `bun run check` vert) ; en cas de divergence, le dépôt fait foi et la divergence va au journal.
2. Lis `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`, `specs/01-plan.md`, `specs/diagnostics.md`, `specs/ecarts.md` et tous les fichiers de `specs/adr/`. Toutes leurs règles s'appliquent, sans exception : TDD strict, dette datée, écarts consignés, aucune valeur en dur hors `tokens.css`, frontière de test du rendu, `code` + `params` uniquement (ADR 0002), ADR 0003 et 0004, revue indépendante en lecture seule, aucune API Bun dans les packages runtime, déterminisme.
3. Ne lance jamais `claude` depuis le shell. Ne demande aucune validation.

## Boucle par lot
1. **Cadrage** : branche `lot/<id>-<nom>` depuis `main` ; `specs/lots/<id>.md` écrit à partir du code réel (arborescence cible, API ou routes, arborescence des tests, définition de terminé) ; commit `docs:`.
2. **Implémentation** en TDD, un commit par étape verte. Tout test d'invariant est prouvé rouge en réintroduisant temporairement le défaut, puis le fichier est restauré et `git diff` vérifié vide sur ce fichier. Jamais `git stash` ni `git checkout-index` pour ce contrôle. Avant de régénérer un golden, relis le diff du golden : une régénération ne bénit jamais une régression.
3. **Revue indépendante**, par un sous-agent qui n'a pas vu l'implémentation, strictement en lecture seule (un `git worktree` temporaire pour expérimenter). Elle relit le diff contre `specs/lots/<id>.md`, cherche en priorité les tests incapables d'échouer et les commentaires qui promettent plus que le test ne vérifie. Corrections selon l'ADR 0003.
4. **Vérification** : `bun install --frozen-lockfile && bun run check && bun run e2e` depuis un arbre sans aucun `dist/`, smoke test Node du binaire buildé, définition de terminé cochée point par point.
5. **Intégration** : `git checkout main && git merge --no-ff lot/<id>-<nom>`, `bun run check` sur `main`.
6. **Suivi** : `progress.md` mis à jour (lot terminé, prochaine action, journal), commit sur `main`, puis lot suivant sans attendre.

## Décisions
- Réversible (technique, structure, nommage, format, comportement d'UI) : tranche seul, au niveau d'une revue d'architecture exigeante, et consigne-la dans `specs/adr/NNNN-titre.md` au prochain numéro libre.
- Irréversible ou externe (`npm publish`, dépôt distant, push, réécriture de l'historique de `main`, fichier dont la licence interdit la redistribution) : jamais. Prépare tout, puis `Statut : BLOQUÉ` dans `progress.md` avec les commandes exactes attendues.
- Données tierces : licence vérifiée sur pièces et provenance consignée avant toute copie. Logos via le paquet npm `simple-icons` (CC0) en devDependency ; un logo d'éditeur seulement si sa charte l'autorise explicitement ; sinon l'icône générique de la couche.
- Front : `/impeccable shape` avant toute surface nouvelle, `critique` puis `audit` après, `polish` en fin de lot, `document` dès que les tokens changent.

## Gestion du contexte
Ne t'arrête jamais de toi-même : la compaction automatique du contexte gère la longueur de la session

## Lots, dans cet ordre

### L3 — taxonomie, catalogue, overlay OWASP
- `@keelson/taxonomy` : les 13 couches de l'OWASP DevSecOps Guideline (secrets git, SCA, SAST, IaC, supply chain, IAST, sécurité des API, DAST, CNAPP, scan d'infrastructure, scan continu, conformité, sécurité IA/LLM) et les catégories plateforme (SCM, dépôts d'artefacts et registres, secrets, agrégation de vulnérabilités, qualité de code serveur, observabilité runtime, sécurité runtime, policy-as-code), chacune `source: owasp | platform`. Source citée : https://github.com/OWASP/DevSecOpsGuideline.
- `@keelson/catalog` : 50 à 100 outils, un YAML par outil validé par zod (`id`, `name`, `kind: job | service`, `layers`, `license`, `homepage`, `logo`, `detect`, `snippets.gitlab`, `snippets.github`, `lastVerified`). Au moins deux outils par couche OWASP dont un open source ; obligatoires : DefectDojo, Dependency-Track, Nexus, Harbor, Artifactory, Vault, SonarQube, Sentry, Falco. Chaque fiche vérifiée sur le site officiel, URL de vérification dans la fiche.
- Détection des couches par job via `detect` (sur `image` et `script`), surchargeable dans `.devsecops/layout.json`.
- UI : overlay colorant les jobs par couche, panneau « couches non couvertes », vue Catalogue (filtres couche, licence, adaptateur), fiche outil.
- CLI : `keelson coverage [--require <couches>] [--format json]` (code 1 si une couche requise manque) ; `keelson catalog lint` (schéma, logos, `lastVerified` > 6 mois).
- Les écarts déjà rattachés à L3 dans `specs/ecarts.md` sont traités et clos avec preuve.

### L4 — toolchain
`.devsecops/toolchain.yaml` : services en instances nommées (nom, outil du catalogue, URL, environnement) et intégrations job → service (`push`, `upload-report`, `fetch-secret`, `notify`). Inférence des intégrations depuis les scripts via le catalogue, confirmées ou corrigées dans le fichier. Aller-retour du fichier par opérations avec les quatre propriétés fast-check. Vue Toolchain avec positions libres persistées dans `.devsecops/layout.json`. `keelson validate` couvre la toolchain.

### L5 — propositions et insertion
Depuis une couche non couverte : liste des outils du catalogue, prévisualisation du diff YAML, insertion du job par une opération composite à inverse unique. `keelson export` vers des formats documentés, au minimum Mermaid et un rapport de couverture en Markdown.

### L6 — adaptateur GitHub Actions
`.github/workflows/*.yml` vers l'IR et retour : mêmes opérations, mêmes propriétés, corpus sous licence vérifiée (SHA épinglé, notice reproduite), détection dans le workspace, snippets `github` du catalogue exploités. Les `include` n'existent pas ici ; les `uses` de workflows réutilisables sont signalés non résolus avec un code dédié.

### L7 — packaging open source
README complet avec captures, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, templates d'issues et de PR, workflow de release (changelog, versionnage sémantique), `npm pack` vérifié en installation propre sur Node 20 et 22. Ne publie pas : `BLOQUÉ` avec la liste exacte des commandes.

### L8 — flotte
`keelson apply ops.json` (opérations sérialisées sur un dépôt, simulation par défaut, écriture sur option). `keelson fleet coverage <manifeste>` : couverture agrégée de N dépôts locaux, cache par hash de fichier, mise à jour incrémentale, sortie JSON et Markdown.

## Fin
Quand L8 est fusionné : `Statut : TERMINÉ` dans `progress.md`, et un rapport final : lots fusionnés, ADR créés, écarts les plus structurants, commandes de publication en attente.
