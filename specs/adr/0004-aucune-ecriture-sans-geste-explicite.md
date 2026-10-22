# ADR 0004 — Aucune écriture sans geste explicite

Date : 2026-10-22 · Décidé par : le pilote · Statut : accepté

## Contexte

La passe `/impeccable critique` du 2026-10-22 note la prévention d'erreur à **1/4** et relève deux
chemins par lesquels Keelson réécrit le fichier de l'utilisateur sans qu'il ait demandé une écriture.

Le premier est le plus grave parce qu'il est invisible. Le `<select>` de stage soumettait
`setJobStage` sur `onChange`. Sous Windows et Linux, les flèches dans un `<select>` **fermé** émettent
`change` à chaque appui : un utilisateur au clavier qui parcourt les options pour les **lire**
réécrit son YAML une fois par touche. Descendre trois options produisait trois opérations, trois
écritures atomiques et trois entrées d'historique. L'utilisateur n'avait rien choisi.

Le second est visible mais irréversible d'un geste : `Delete job` réécrivait le fichier sur un clic
unique, sans confirmation, sans nommer ce qui dépendait du job. L'annulation existe — Ctrl+Z — mais
n'est documentée nulle part à l'écran, et `PRODUCT.md` fait de la non-destruction du fichier la
proposition centrale du produit.

Les deux partagent une cause : l'UI traitait un **changement d'état de contrôle** comme une
**intention d'écrire**.

## Options

1. **Laisser le select et ajouter un `debounce`.** Réduit le nombre d'écritures sans supprimer la
   classe de défaut : parcourir les options écrit toujours, juste moins souvent. Et le dernier état
   parcouru devient celui qui est écrit, ce qui est pire — l'utilisateur s'arrête sur une option en
   la lisant et c'est celle-là qui part.
2. **Remplacer le `<select>` par un contrôle non natif.** Supprime le symptôme en abandonnant une
   affordance native que le brief demande explicitement de conserver, et crée une surface
   d'accessibilité à maintenir à la main.
3. **Séparer le choix de l'engagement**, pour tout ce qui écrit.

## Décision

Option 3. Une règle unique, tenue partout dans l'UI :

**Un contrôle qui change une valeur ne déclenche jamais d'écriture. L'écriture part d'un geste
nommé, dont le libellé dit ce qui va être écrit.**

- Le `<select>` de stage alimente un état local. Un bouton **« Move to stage »** soumet, et reste
  inerte tant que le stage affiché est celui du job.
- `Delete job` ouvre une confirmation `role="alertdialog"` qui **nomme le job** et **liste les jobs
  qui en dépendent**, calculés depuis le pipeline. Le bouton de confirmation est libellé
  **« Delete <job> »**, pas « OK » : le libellé est la dernière chance de voir ce qu'on fait.
- Restent hors de cette règle les gestes dont l'intention est déjà portée par le geste lui-même :
  `Add stage`, `Add need`, `Rename`, `Create job`, `Set environment`. Ce sont des boutons ; ils
  n'ont jamais écrit sur un simple changement de valeur.

## Conséquences

- Le chemin clavier **gagne un geste** sur le déplacement de stage et la suppression. C'est assumé :
  le geste supplémentaire est celui qui transforme un parcours en décision. Les tests E2E clavier
  vérifient que la confirmation est atteignable et franchissable sans souris.
- Trois tests qui asservissaient l'ancien comportement sont réécrits plutôt que supprimés — ils
  décrivent la même intention utilisateur avec le geste explicite. Un test E2E vérifie en plus que
  le fichier sur disque **n'a pas bougé** tant que la confirmation n'est pas franchie.
- La confirmation calcule les référents **côté client, depuis le pipeline**, et ne remplace pas le
  refus `JOB_REFERENCED` du serveur, qui reste l'autorité. Le client prévient, le serveur tranche.
  Un test E2E couvre encore le cas où le serveur refuse après confirmation.
- Cette règle s'étendra aux lots suivants : L4 (toolchain) et L5 (insertion de jobs) ajoutent des
  contrôles qui écrivent, et ils héritent de la séparation choix / engagement sans la rediscuter.
- Limite connue, non traitée ici : une fois l'écriture faite, rien ne dit encore **ce qui** a été
  écrit. L'affichage du diff depuis `touched` est une surface nouvelle, consignée en écart au titre
  de l'ADR 0003.
