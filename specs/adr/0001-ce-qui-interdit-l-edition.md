# ADR 0001 — Ce qui interdit l'édition

Date : 2026-10-21 · Lot : L2 · Statut : accepté

## Contexte

Le store de l'UI désactivait l'édition dès qu'un diagnostic de sévérité `error` était présent :

```ts
status === "ready" && !diagnostics.some((d) => d.severity === "error")
```

Ce code a longtemps paru correct parce qu'il était faux pour une autre raison : le serveur ne
renvoyait que les diagnostics de **parsing**. `validate()` n'était jamais appelé côté serveur, alors
que `keelson validate` en CLI combine bien les deux familles. Les quatre diagnostics de validation
(`UNKNOWN_NEED`, `NEEDS_CYCLE`, `UNKNOWN_STAGE`, `NEED_LATER_STAGE`) n'atteignaient donc jamais
l'UI, et le panneau de diagnostics était silencieusement incomplet.

En corrigeant le serveur pour qu'il combine `parse` et `validate`, un test E2E a immédiatement
échoué : un `needs` vers un job inexistant est de sévérité `error`, donc l'UI basculait sur l'état
« ce fichier ne peut pas être analysé » et désactivait l'édition. L'utilisateur se retrouvait dans
l'impossibilité de corriger l'erreur qu'on venait de lui signaler.

## Options

1. **Garder le verrou sur toute erreur.** Cohérent en apparence, mais absurde à l'usage : une faute
   de frappe dans un `needs` gèle l'outil entier. C'est exactement l'inverse du service attendu.
2. **Supprimer tout verrou.** L'édition resterait possible sur un fichier que l'IR ne sait pas
   modéliser. Or les opérations calculent leurs plages depuis les nœuds de la lib `yaml` : sur un
   document qui ne parse pas, il n'y a pas d'arbre, donc pas de plage, donc rien à patcher. Le
   serveur refuserait de toute façon, mais avec un message obscur au lieu d'un état clair.
3. **Verrouiller sur l'impossibilité de modéliser, pas sur la gravité.** Seul `INVALID_YAML`
   interdit l'édition. Les diagnostics de validation sont affichés, cliquables, et laissent l'édition
   ouverte.

## Décision

Option 3. Une fonction nommée porte le critère, pour qu'il soit lisible et testable :

```ts
export function blocksEditing(diagnostic: Diagnostic): boolean {
  return diagnostic.code === INVALID_YAML;
}
```

Le serveur combine désormais `parse` et `validate` dans `/api/documents/:file` et dans la réponse
d'une opération, ce qui aligne l'API sur `keelson validate`.

## Conséquences

- La sévérité d'un diagnostic décrit sa **gravité**, jamais son **effet sur l'outil**. Les deux
  notions sont découplées et ne doivent pas être reconfondues.
- Un pipeline avec un cycle de `needs` reste éditable : c'est la seule façon de casser le cycle
  depuis l'UI.
- Tout nouveau code de diagnostic qui rendrait le document non modélisable devra être ajouté
  explicitement à `blocksEditing`, et non hérité d'une règle sur la sévérité.
- Le panneau de diagnostics devient réellement utile : il porte enfin les quatre diagnostics de
  validation, qui sont ceux qui intéressent l'ingénieur plateforme.
