# ADR 0001 — What forbids editing

Date: 2026-10-21 · Milestone: L2 · Status: accepted

## Context

The UI store disabled editing as soon as any diagnostic with severity `error` was present:

```ts
status === "ready" && !diagnostics.some((d) => d.severity === "error")
```

This code looked correct for a long time because it was wrong for another reason: the server only
returned **parsing** diagnostics. `validate()` was never called on the server side, whereas the
`keelson validate` CLI command does combine both families. The four validation diagnostics
(`UNKNOWN_NEED`, `NEEDS_CYCLE`, `UNKNOWN_STAGE`, `NEED_LATER_STAGE`) therefore never reached the
UI, and the diagnostics panel was silently incomplete.

As soon as the server was fixed to combine `parse` and `validate`, an E2E test failed: a `needs`
pointing at a nonexistent job has severity `error`, so the UI switched to the "this file cannot be
parsed" state and disabled editing. Users were left unable to fix the very error they had just
been shown.

## Options

1. **Keep the lock on any error.** Consistent on the surface, absurd in practice: a typo in a
   `needs` freezes the whole tool. That is the exact opposite of the expected service.
2. **Remove the lock entirely.** Editing would stay possible on a file the IR cannot model. But
   operations compute their ranges from the `yaml` library's nodes: on a document that does not
   parse, there is no tree, hence no range, hence nothing to patch. The server would refuse anyway,
   but with an obscure message instead of a clear state.
3. **Lock on the inability to model, not on severity.** Only `INVALID_YAML` forbids editing.
   Validation diagnostics are displayed, clickable, and leave editing open.

## Decision

Option 3. A named function carries the criterion, so that it is readable and testable:

```ts
export function blocksEditing(diagnostic: Diagnostic): boolean {
  return diagnostic.code === INVALID_YAML;
}
```

The server now combines `parse` and `validate` in `/api/documents/:file` and in the response to an
operation, which aligns the API with `keelson validate`.

## Consequences

- A diagnostic's severity describes its **gravity**, never its **effect on the tool**. The two
  notions are decoupled and must not be conflated again.
- A pipeline with a `needs` cycle stays editable: that is the only way to break the cycle from the
  UI.
- Any new diagnostic code that would make the document unmodelable must be added explicitly to
  `blocksEditing`, not inherited from a rule on severity.
- The diagnostics panel becomes genuinely useful: it finally carries the four validation
  diagnostics, which are the ones a platform engineer cares about.
