---
version: 1
slug: "src-views-pipeline"
primary_target: "src/views/pipeline"
related_targets: ["src/panels"]
---

## Scope and mode

The Pipeline view in `packages/ui/src/views/pipeline` plus its panels. Mode: **Operate** — the
engineer completes a task. Expression never obscures the task, the state, or a familiar affordance.

## Audience and job

The DevSecOps / platform engineer, in a local repo, on a desktop. Job: see the whole pipeline at
once, understand where every value comes from, and edit it without damaging the file. Reads the git
diff afterwards, so every action is judged on the diff it produces.

## Direction

**The category standard, played straight** — chosen as the standing exit on 2026-10-21 over an
assigned "normative specification sheet" direction (seed `c62e321c`, assigned index 3). Stage
columns, job cards, dependency edges, interface sans-serif. Craft bar: Linear, Vercel, Raycast —
their execution quality, not their layout. Recorded as a brand commitment in PRODUCT.md; the
discarded directions are not to be smuggled back in.

## Load-bearing states

Loading · no CI file detected · YAML invalid (diagnostics shown, editing disabled) · file deleted on
disk · file changed on disk (reloaded, undo/redo stacks cleared) · operation rejected (server message
shown verbatim) · 409 stale (reloaded, stacks cleared, told the change was not applied) · pending
operation in flight.

## Memorable moment

The **origin badge**. Every inherited value says where it comes from — "inherited from .base",
"from anchor &defaults", "default" — and that badge is what makes the editing safe: it tells you
that changing this value writes an override in *this* job and never touches the template. No
competitor shows this, and it is product principle 2 made visible.

## Constraints

WCAG 2.1 AA. Every drag has a keyboard equivalent in the panel; state is never carried by hue alone.
The graph needs a keyboard-navigable, screen-reader-legible equivalent, not only a visual one.
UI text in English, externalised. No hard-coded colour, size, radius or spacing outside DESIGN.md
tokens.

## Unresolved

- DESIGN.md does not exist yet: it is written at finish, by the documenter, from the built world.
- Diagnostics from `@keelson/core` are in French while the UI is in English — to settle in L2.
