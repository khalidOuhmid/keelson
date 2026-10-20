# Keelson — vision

## Le problème

Concevoir une chaîne DevSecOps se fait aujourd'hui soit dans un outil de diagramme déconnecté du
code, soit directement dans le YAML CI où l'on perd la vue d'ensemble. Dans les deux cas, personne ne
sait dire quelles couches de sécurité sont réellement couvertes, ni ce qu'il manque.

## La proposition

Keelson est un outil open source (Apache-2.0, auteur : Khalid Ouhmid) qui permet de concevoir
visuellement une chaîne DevSecOps avant de l'implémenter, en restant branché sur les fichiers réels
du dépôt :

- **Le pipeline CI en aller-retour avec le YAML natif.** GitLab CI d'abord, GitHub Actions ensuite.
  Le YAML du dépôt est la source de vérité : on le lit, on l'affiche, on l'édite par patch en place.
  Un parse puis emit sans modification doit produire des octets identiques — commentaires, ordre des
  clés et anchors préservés.
- **Les services de la plateforme autour du pipeline.** Nexus, Harbor, DefectDojo, Vault, Sentry… en
  instances nommées, avec leurs intégrations avec les jobs du pipeline (push d'artefact, upload de
  rapport, récupération de secret, notification).
- **Un overlay de couverture.** Les 13 couches de l'OWASP DevSecOps Guideline, plus des catégories
  plateforme hors OWASP, projetées sur le pipeline et la toolchain : ce qui est couvert, par quoi, et
  ce qui ne l'est pas.
- **Un catalogue de 50 à 100 outils.** Logos, licences, motifs de détection et snippets prêts à
  insérer, qui proposent des implémentations concrètes pour les couches non couvertes.

## Usage final

```sh
npx keelson start          # ouvre une UI web locale dans le dépôt courant
keelson validate           # valide pipeline et toolchain
keelson coverage           # rapporte la couverture, code ≠ 0 si une couche requise manque
keelson export             # exporte le modèle
```

## Principes

- **Le dépôt est la source de vérité, pas Keelson.** Keelson n'introduit aucun format propriétaire
  qui remplacerait le YAML CI. Les deux seuls fichiers qu'il possède sont
  `.devsecops/toolchain.yaml` (les services et intégrations, non déductibles du CI) et
  `.devsecops/layout.json` (positions des nœuds, surcharges de couche).
- **Local d'abord.** Pas de service distant, pas de compte. `npx keelson start` et c'est tout.
- **L'aller-retour est non négociable.** Un outil qui réécrit le YAML en perdant les commentaires est
  un outil qu'on n'utilise pas deux fois.
- **Ce que l'IR ne modélise pas est conservé tel quel** dans des blocs opaques, jamais reconstruit.
- **Ne rien prescrire sans justifier.** Chaque proposition d'outil renvoie à la couche OWASP qu'elle
  couvre, avec sa licence et un snippet vérifiable.

## Hors périmètre

Keelson ne déploie rien, n'exécute aucun pipeline, ne scanne aucun code. Il conçoit, documente et
écrit de la configuration.

Découpage en lots et détail technique : [01-plan.md](01-plan.md).
