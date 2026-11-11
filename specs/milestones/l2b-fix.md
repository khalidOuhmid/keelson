# Milestone L2b-fix — what the L2b report had not said

Scoping written from `main` at `3a79f9f`. Four shortcomings of L2b, in the order set by Khalid.

## 1. Red proofs of the five unproven fixes

Each real defect is reintroduced, the test must turn red, the file is restored **by rewriting it**
and `git diff` is checked empty on that file. Neither `git stash` nor `git checkout-index`: a
`checkout-index` destroyed a fix during L2b.

| # | Fix | Reintroduced defect | File |
| --- | --- | --- | --- |
| 1 | Symbolic link outside the root | read without checking the real path | `adapter-gitlab/src/reader.ts` |
| 2 | `extends` precedence | template sources interleaved with the definitions | `adapter-gitlab/src/resolve.ts` |
| 3 | `isPartial` on a broken local include | `failed` outside `Pipeline.unresolved` | `adapter-gitlab/src/parse.ts` |
| 4 | Opaque blocks of an overridden job | blocks taken from the last definition only | `adapter-gitlab/src/parse.ts` |
| 5 | Origin badge help text | `hintFor` always returns `ORIGIN_HINT` | `ui/src/views/pipeline/origin.ts` |

A test that does not turn red is replaced by one that does, and recorded in the log with its cause.

## 2. Severity of `EXTENDS_TARGET_NOT_FOUND`

| Situation | Severity | Reason |
| --- | --- | --- |
| all includes resolved | `error` | nothing can explain the absence |
| **broken local** include, alone | `error` | its cause is already a named error, to be fixed; nothing is unknown |
| unresolved **remote** include, broken or not alongside | `warning` | its target may come from a file Keelson does not read |
| `parse` without a reader | `warning` | the `local` was not looked up, it is not broken |

The severity therefore follows `resolution.unresolved` and not the merged list `Pipeline.unresolved`,
which remains what it says: what is missing from the displayed pipeline. **ADR 0007.**

## 3. Origin badge help text

The text depends on **two** things, the job and the origin, not on the origin alone:

| Job | Origin | Text |
| --- | --- | --- |
| main file | `extends`, anchor, `!reference`, default | `ORIGIN_HINT`, unchanged |
| main file | `include` | the override is written in this job, the included file is not touched |
| included file | all | nothing can be overridden here |

`OriginBadge` gains `readOnly`. The promise "the override is written" is proven at the `apply`
level, not only on screen.

## 4. `/impeccable polish`

On `packages/ui/src`, the pass L2b was supposed to run at the end of the milestone.

## Touched tree

```
packages/adapter-gitlab/src/parse.ts            extendsSeverity
packages/adapter-gitlab/test/includes.test.ts   severity
packages/adapter-gitlab/test/operations/includes.test.ts   override of a value coming from an include
packages/core/src/ir.ts                         UnresolvedInclude comment
packages/ui/src/views/pipeline/{origin.ts,OriginBadge.tsx}
packages/ui/src/panels/JobDetailPanel.tsx
packages/ui/test/includes.test.tsx
specs/{diagnostics.md,gaps.md,progress.md,adr/0007-*.md}
```

## Definition of done

1. Five red proofs recorded, restoration checked each time.
2. The four rows of the severity table are each a test proven red.
3. The three rows of the help-text table are each a test on the rendered DOM, proven red.
4. `polish` run and its findings addressed or recorded.
5. Read-only independent review, triage per ADR 0003.
6. `bun install --frozen-lockfile && bun run check && bun run e2e` from a tree without `dist/`,
   Node smoke test of the binary.
7. `merge --no-ff` into `main`, `bun run check` on `main`, log, "Next action: L3, scoping".
