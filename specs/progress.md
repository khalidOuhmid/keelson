# Milestone tracking

Status: ALL MILESTONES DELIVERED (2026-11-11); completion pass done (2026-11-13), every planned gap closed or dated
Current milestone: none — follow-up in `specs/gaps.md`
Next action: merge the completion PR, add the `NPM_TOKEN` secret, then tag `v0.1.0`.
Blocker: none

Milestones are developed on `milestone/<id>-<slug>` branches from now on; the branches listed below
keep their historical `lot/<id>-<slug>` names.

| Milestone | Status | Merge |
|-----|--------|-------|
| L0 — monorepo foundation | DONE | `main` (branch `lot/l0-socle`, created as `main`) |
| L1 — `core` + `adapter-gitlab` | DONE | `2a48b5a` (`--no-ff`) |
| L2 — server, Pipeline view, `keelson start` | DONE | `894464c` (`--no-ff`) |
| L2c — messages: `code` + `params`, English only, `details` merged | DONE | `82bcb79` (`--no-ff`) |
| L2b — local `include` resolution, per-file origin, bounded writes | DONE | `5a5b530` (`--no-ff`) |
| L2b-fix — red proofs, severity, help text, polish | DONE | `a88faf2` (`--no-ff`) |
| L3 — taxonomy, catalogue, OWASP overlay | DONE | `36caaa1` (`--no-ff`) |
| L4 — toolchain | DONE | `fd63570` (`--no-ff`) |
| L5 — proposals and insertion | DONE | `971ae5b` (`--no-ff`) |
| L6 — GitHub Actions adapter | DONE | `lot/l6-github` merged into `claude/wonderful-edison-vituwb` |
| L7 — open-source packaging | DONE | branch `claude/wonderful-edison-vituwb` |
| L8 — fleet | DONE | merged into `claude/wonderful-edison-vituwb` |
| Completion pass — closing `specs/gaps.md` | DONE | branch `claude/wonderful-edison-vituwb` |

## Log

### 2026-11-13 — completion pass

Every gap of `specs/gaps.md` written before 2026-11-12 now carries a dated **CLOSED** or **PARTLY
CLOSED** note naming the test that proves it. Six findings of the pass itself are recorded as new
rows dated 2026-11-13. Verification: `bun run check` (four chmod tests fail only when run as
root), `bun run e2e` 118 passed, property tests at 500 runs.

### 2026-10-21 — L2 — tracking created, then steps 4 and 5

`specs/progress.md` and `specs/milestones/l2.md` did not exist: the first is reconstructed from the
repository, the second written from the delivered code, since the milestone had been driven by
successive prompts without its scoping document. Commit `4a4ed95`.

**Divergence found**: none between the repository and the previous reports. `DESIGN.md` is missing,
which is expected — it is written at the end of the milestone by `/impeccable document`, from the
world as built, not before.

**Step 4 — states** (commit `d288c81`, 22 tests). `Loading`, `NoCiFile`, `InvalidDocument`,
`DocumentRemoved`, `NoticeBar`, plus a shared `EmptyState`. `Loading` is a polite `role=status`.
`NoCiFile` names the folder inspected and the file expected. `InvalidDocument` lists only error
diagnostics and says the file is left intact on disk. `NoticeBar` separates consequence from
information: `stale` and `removed` are `role=alert`, `reloaded` a polite `role=status`; each variant
is named by a word as well as by colour.

**Step 5 — editing** (commits `51a559c` and `45b4c70`, 82 tests). `drafts.ts` builds operations
without React: script split line by line, a need's default values not written, an empty environment
field omitted rather than written as an empty string. `useHistoryShortcuts` handles Ctrl/Cmd+Z and
Ctrl/Cmd+Shift+Z, steps aside inside an input field so as not to steal the browser's native undo, and
goes inert when editing is disabled. `ErrorBanner` shows the server's code and message as is, and
only treats `JOB_REFERENCED` specially, listing its referrers. `JobEditor`, `NewJobForm` and
`StageControls` cover every action of the milestone, each operable from the keyboard; `disabled`
cuts both the controls and the submission path.

Commands: `bun install --frozen-lockfile` → 133 installs / 203 packages, no changes.
`bun run check` → lint 210 files 0 errors, typecheck 0 errors, **852 pass / 0 fail**, full build.
`detect.mjs --json packages/ui/src` → 0 entries at each step.

**Dated debt**: none added. **Gaps**: none new, the five entries of `specs/gaps.md` are unchanged.
**ADR**: none created — every decision in these two steps was a local component choice, with no
architectural consequence worth recording.

Two accessibility decisions made in earlier steps that remain in force: `role="group"` rather than
`<section aria-label>` for stage columns and opaque blocks, so as not to flood the landmark list
(Biome rule `useSemanticElements` suppressed locally with its reason, `<fieldset>` being reserved for
form controls); and the `aria-describedby` description element placed as a sibling of the button,
never inside it, or it would pollute its accessible name.

### 2026-10-22 — L2 — steps 6, 7, 8, 10 and start of 9

**Step 6** (`eac1490`, 25 tests). `readToken` reads `?token=` then erases it with
`history.replaceState`, keeping the other parameters. `app.tsx` assembles everything with injectable
dependencies: the 18 tests drive a fake client and a fake subscription and cover the full path of an
edit up to the 409.

**Step 7** (`73838c3`, 7 tests). `scripts/dev.ts` + Vite proxy. `changeOrigin` is essential: it
rewrites `Host` to `127.0.0.1:5284`, which the `Host` check requires. Verified end to end —
`/api/workspace` answers 200 through the proxy with no client-side token, 403 directly without one.

**Step 8** (`ca33096`, 24 E2E scenarios on the built binary). Replaces `app.e2e.ts`; Playwright no
longer starts a `webServer`, each test manages its own binary, and `bun run e2e` builds first. **Two
fundamental defects found by these tests**:

1. The server **never** called `validate()`: only parsing diagnostics reached the UI, whereas
   `keelson validate` combines both families. `UNKNOWN_NEED`, `NEEDS_CYCLE`, `UNKNOWN_STAGE` and
   `NEED_LATER_STAGE` were invisible in the panel. Fixed in the server store, on load as well as in
   operation responses, with 6 tests.
2. That fix exposed a design flaw: `canEdit()` locked on **any** error, so a `needs` pointing to a
   non-existent job made the tool unusable for fixing that very `needs`. The lock now applies to
   `INVALID_YAML` alone, through `blocksEditing()`. **ADR 0001.**

**Step 10** (`b48a349`). `specs/01-plan.md` describes the API, the four write guarantees and the
security model with the reason for each measure. `CLAUDE.md` describes `bun run dev`.

**Start of step 9** (`0e95e68`). Desktop and mobile screenshots produced, then **two defects fixed
that only visual inspection could reveal**, with every unit test passing: job nodes were placed at
`y=0` in their column, exactly under the header, which they covered; and the diagnostics panel took a
fixed quarter of the height to display "No diagnostics".

Commands: `bun run check` → lint 218 files 0 errors, typecheck 0 errors, **894 pass / 0 fail**.
`bun run e2e` → **24 passed**. `detect.mjs` → 0 entries.

**ADR**: `specs/adr/0001-what-forbids-editing.md`. **Dated debt**: none added.
**Gaps**: three added on 2026-10-22 (graph re-framing, sidebar without grouping, `critique` and
`audit` passes not run).

### 2026-10-22 — L2 — step 9: `critique` pass

Resume check first: clean tree, branch `lot/l2-pipeline-ui` at `10b85d8`, `bun run check` green
(lint 0, typecheck 0, **894 pass / 0 fail**, full build). No divergence between `progress.md` and the
repository. Screenshots regenerated with `bunx playwright test packages/ui/e2e/shots.e2e.ts` — at an
identical byte size, so the front end had not moved.

`/impeccable critique packages/ui/src` run **in dual sub-agent mode**, as its invariant requires: A,
an unanchored design review, and B, the detector and browser evidence, isolated from each other. No
degradation banner. Report persisted in
`packages/ui/.impeccable/critique/2026-10-22T10-21-57Z__packages-ui-src.md`. **Score 20/40**, 3 P0
and 2 P1. First run for this target, so no trend.

**The closing interview of `critique` was not run**, a declared substitution under Impeccable's
`AUTONOMY_DIRECTIVE_CHECK` directive: the three answers it asks for — priority, tonal intent, scope —
are already written and are not reopened. The scope comes from this file, the tonal intent from the
surface brief, the priority from the milestone order.

**What the detector says, and what it does not.** `detect.mjs --json packages/ui/src` returns 0 on
41 files. B refused to take that zero at face value and backed it up: extensions within scope, no
rule ignored, and a synthetic control file that does make the detector exit with 2. The static engine
only covers ~5 of the 59 rules on source; the other 54 are browser rules. **That is where all the
signal was: 14 in-page findings, at both viewports**, 12 of which trace back to a single
`--text-2xs: 10px` below the 11 px floor. Two false positives dismissed with their reason:
`overused-font: roboto` is an artefact of this Linux machine having no earlier font in the system
stack, and `clipped-overflow-container` belongs to the `@xyflow/react` stylesheet, which must clip
its viewport to work.

**Three P0 defects, all verified against the evidence before being accepted** — a sub-agent can be
wrong, and these findings decide the end of the milestone:

1. **The Pipeline view shows a job in the wrong column.** Read directly on `review/desktop.png`:
   header `build` "1 job", two cards inside, one of them `lint` subtitled `test`. It is the one thing
   this view exists to say, and it says it wrong, on the project's dev fixture, with `layout.test.ts`
   and `graph.test.ts` green. Those tests check that the layout is *computed*, never that it is
   *true*.
2. **`JobEditor` without a `key`**: verified in `app.tsx` and `JobEditor.tsx`. Local state survives a
   change of selection, so `Rename` can write into the YAML a name the user never typed.
3. **Silent write loop**: `dismissNotice()` only resets `notice` to `null` — the `Dismiss` button of
   the error banner is dead, verified line by line; `grep pending src/ --include=*.tsx` returns **no**
   lines, although the store maintains it; `touched` reaches `client.ts` and is read nowhere.

A's contrast arithmetic was redone independently by converting the `oklch` values back to relative
luminance: `border-default` on `surface-1` at **1.63:1** and `text-muted` on `surface-3` at
**4.03:1**, within a hundredth of the announced figures. Both miss the WCAG 2.1 AA commitment of
`PRODUCT.md`.

**ADR created: `0003-what-a-review-reopens-in-a-milestone.md`.** The rule "out of scope → gap",
taken literally, would have allowed merging L2 while knowing its main view was wrong. The ADR decides
by the nature of the defect, not by the date it was found: whatever makes a delivered step fail to
deliver what it announced reopens the milestone; any new interaction surface, which requires a
`shape` pass, becomes a gap. In one sentence: *a review can reopen a promise, never add one.*

**Gaps**: seven added, all in the "new surface" or "outside L2" category — graph keyboard model,
diff after write, search and palette, reading posture for the security architect, partial pipeline
indicator (attached to L2b), template in a ghost column, and the binary non-reproducibility of review
screenshots, which dirties the tree on every pass and would stop the autopilot loop.

**Dated debt**: none added. **Divergence**: none.

The most unsettling finding of the pass is not visual. `EdgeData.highlighted` and `pending` are both
modelled, unit-tested, and invisible on screen. The test boundary stops at the store and never
crosses into the render — which is exactly how a column can draw the wrong job without a single test
turning red.

### 2026-10-22 — L2 — step 9: fixes A1 and A2

**A1 — `df96b19`.** The invariant test required by ADR 0003 failed on the first run on `lint`, the
job with no edge, exactly as the screenshot showed; the other three scenarios passed. The partition
becomes authoritative: `x` comes from the column index, elkjs now only decides `y`.

That fix created another defect, and it was the second invariant that caught it: forcing `x` brings
back into one column nodes that elkjs had separated into layers, hence at the same `y`, and two
isolated jobs overlapped. Resolved by keeping elkjs's order and shifting downwards. The graph height
is recomputed from the nodes, which that shift can push below elkjs's height. Screenshot regenerated
and re-read: `lint` is in `test`, which announces "2 jobs" and contains two.

**A2 — `51b43f5`.** The test returned `Expected: "unit", Received: "compile"` — the exact defect.
Fixed with `key={selected.id}`. Two traps met while writing the test, both in the test and not in the
code: a synchronous `getByRole` right after render, where the existing tests wait for the node with
`findByRole`; and the `/job id/i` selector, which also matches "New job id" in the left bar and
produced "Found multiple elements". Exact name since.

Added along the way, same family: the environment fields initialised empty even when the job carried
one, so the panel showed `name: production` above two empty fields.

`bun run check` → lint 0, typecheck 0, **904 pass / 0 fail**, full build. Clean tree.
**ADR**: none new. **Dated debt**: none. **Gaps**: none new.

### 2026-10-22 — L2 — two test rules added by Khalid

Two non-negotiable rules written into `CLAUDE.md` and into the autopilot prompt, in direct response
to the finding at the end of the `critique` pass:

- **render test boundary**: any state or data computed for the UI must have at least one test of its
  effect in the rendered DOM or in E2E, not just of its value; a computed field with no on-screen
  consumer is either wired up or deleted;
- **layout invariants**: consistency between the IR and the display is tested on the render and in
  E2E, not only on the computed coordinates.

They made **the two invariants written earlier that day insufficient**, since those only checked
coordinates. Hence, commit `de19d2e`:

- two tests on the rendered DOM in `app.test.tsx` — each job lands in the column of the stage it
  **announces**, and the header count equals the number of jobs rendered in the column;
- an E2E test on the real binary and the dev fixture, which adds vertical non-overlap.

Two traps are worth recording, because they would have produced worthless green tests. **First**:
the harness pipeline is made entirely of edges and so does not reproduce the shape of the defect — a
job *without* an edge in a late stage. The tests passed by construction. An orphan job was added to
the test fixture. **Second**: the first version of the containment test checked "in exactly one
column" and not "in **its** column"; it stayed green with the original defect put back, since a
misplaced job is still in *a* column.

Both versions were **verified red** by temporarily putting the original placement back in
`layout.ts`, then the file was restored identical to the commit (`git diff` empty). The stage is read
from the node's accessible description, not from the IR: the invariant compares the display with
itself, not the computation with itself.

`bun run check` → **906 pass / 0 fail**. `bunx playwright test pipeline.e2e.ts` → 12 passed.

Consequence for what follows: item A4 (`pending`) and reclassifying `EdgeData.highlighted` as item C
are no longer optional. Both fields are computed, tested and invisible; the rule requires wiring them
up with a DOM test, or deleting them.

SESSION ENDED — resume with the same prompt

### 2026-10-22 — L2 — milestone closed

Two successive independent reviews, by sub-agents that had not seen the implementation.

**The first** returned a disqualifying finding: `applyPayload` never refreshed `text`, although the
ranges of opaque blocks come from the new pipeline. After any edit that shifted offsets, the viewer
showed a fragment overlapping another job's key — on the one surface whose written guarantee is
"this is intact". Since the watcher stays silent on the server's own writes, no reload ever repaired
it. It also proved that **two E2E tests could not fail**, and that `bun run check` was red on a fresh
clone, the `test` before `build` order only passing here thanks to a leftover `dist/ui`.

**The second**, strictly read-only in an isolated worktree, found that `JobEditor` could still submit
a job the user had not chosen — the same class as mounting without a `key`, the need selector showing
one target while the state kept another — and that two of the first review's fixes had no test able
to fail. The repository came out intact: same `HEAD`, same number of commits, clean tree, no
leftover worktree.

**Four ADRs** for the milestone: 0001 (what forbids editing), 0002 (language and messages), 0003
(what a review reopens in a milestone), 0004 (no write without an explicit action).

**The most expensive lesson**: across the milestone, **seven tests turned out to be unable to fail** —
three found by me, two by the first review, two by the second. All were green, all seemed to cover
their subject. The causes repeat: a fixture that does not reproduce the *shape* of the defect, an
assertion constrained by something other than what it claims to measure, and a read that wins the
race against the write it was supposed to forbid. Hence the practice adopted from now on: **every
fix is verified red by reintroducing the real defect**, without `git stash`, the file restored by
rewriting and `git diff` checked empty.

Final verification from a tree with no `dist/` at all: `bun install --frozen-lockfile` then
`bun run check` → **1011 pass / 0 fail**; `bun run e2e` → **35 green**; built binary run under
`node`. `--no-ff` merge into `main` (`894464c`), `bun run check` green on `main`.

### 2026-10-22 — L2c — the whole milestone

Resume check: clean tree, `main` at `b8106c2` (after `894464c`), `bun run check` green
(**1011 pass / 0 fail**). No divergence between `progress.md` and the repository.

**Step 0 — inventory before any line of code** (`cecfa4c`). `specs/milestones/l2c.md` lists the 9
diagnostics, the 13 operation errors, the **6 server transport codes** — undocumented, not declared
as constants, written as literals at every site — and the 44 calls to `fail()` in `apply.ts`, with
file and line. Two scope completions are recorded there, not contradictions: the **CLI chrome**
(usage, help, "no diagnostics") is in French but carries no code, so it is translated in place and
does not enter the registry; and the six transport codes do enter the registry, otherwise the UI
cannot render them and the exhaustiveness test would have its hole exactly where the French was.

**One divergence from the brief, recorded and not followed to the letter**: it asks for an E2E on "a
409 `JOB_REFERENCED`", which the server cannot produce — 409 is reserved for `STALE_DOCUMENT`,
`JOB_REFERENCED` comes out as 422 (`store.ts`). The intent being unambiguous, the E2E takes the real
path: deleting a job that three others need.

**Seven decisions settled during scoping**, all reversible and therefore without an ADR. The main
one: a **`reason`** discriminant in the `params` rather than thirteen new codes, for
`INVALID_OPERATION` (8 situations), `RANGE_OUT_OF_BOUNDS` (9) and `NOT_FOUND` (5). Codes are a public
contract; adding thirteen went beyond the scope. Exhaustiveness of the branches is guaranteed **at
compile time** by the shape of `en.ts`: a code with a `reason` is rendered through a table of
branches, and its runtime shape is what the coverage test walks — the two cannot drift apart.

**The only divergence from the requested layout**: `messages.test.ts` goes in `packages/core/test/`,
not in `src/messages/`. The Node runtime constraint of `CLAUDE.md` requires it — `core`'s `tsconfig`
only includes `src/` with `"types": ["node"]`, and `scripts/check-runtime.ts` fails on any `bun:*`
import in a runtime package's `src/`.

**Steps 1 to 5** (`5f8c9a2`, `f092a91`, `b214be5`, `d072046`, `12f934d`, `524a062`). `Diagnostic` and
`OperationError` become **discriminated unions** on `code`, so the compiler refuses to pair a code
with arbitrary `params`; `renderMessage` accepts a diagnostic or an error directly, which
`render(code, params)` alone could not do without losing the correlation. Deduplication in
`resolve.ts`, which was keyed on the message, is now keyed on a sorted-key serialisation of the
`params` — without that, two different missing `extends` targets would have merged into a single
diagnostic. The server's double hash computation is reduced to `result.value.hash`.

**A defect found by the migration itself**: `ErrorBanner` crashed on a `JOB_REFERENCED` whose
`params` did not carry `referencedBy`. The type requires it, the wire does not guarantee it, and the
exception occurred **while displaying another error** — so at the worst possible moment.

**Step 6 — independent review**, read-only in an isolated worktree, by a sub-agent that had not seen
the implementation. Repository checked intact on return: same `HEAD`, 75 commits, clean tree, no
leftover worktree. It returned **three findings that reopen the milestone and four gaps**, all
verified against the evidence.

**The finding that matters, and it is humbling**: the "`render()` never throws" fix **cancelled out
the coverage test of the same milestone**. The review broke `EXTENDS_CYCLE` — a misspelt `params`
name — and got **908 pass, 0 fail**: the `try/catch` turned the exception into a valid sentence, and
the three guards "non-empty, no `undefined`, no French" were all satisfied by that fallback. A
production safeguard had made inert the test that watched over it. Fixed in two moves: the fixtures
now carry **the expected text of each branch**, and they are exercised through `EN` **directly**,
without the fallback.

Second finding: `render()` could return `undefined` against its own type, because `INVALID_YAML` is
the only renderer whose body is a bare read of `params` — it did not throw, it returned the missing
value, which the CLI then passed to `.replace()`. Not throwing was therefore not enough: `render()`
now guarantees a **non-empty sentence**.

Third finding: three server error paths were not checked, and **my comment claimed the opposite** for
the 413 — pointing to "its describe", where only the code was tested. Yet the 413 is the only body
the server serialises by hand, outside the `fail()` that guarantees the shape: it was the least
guarded path, described as covered. `INTERNAL_ERROR` was not tested either; it is now, by making the
document's folder non-writable so the atomic write throws.

Fourth finding kept, classified as reopening although the review filed it as a gap: `NEED_NOT_FOUND`
rendered **a false sentence**. The two sites had merged under a single text, whereas the second is
only reached after establishing that the need *is* effective — it comes from an anchor alias or a
`!reference`. The sentence stated the opposite of the condition that leads there, and no test reached
that path. Two fixtures now reach it, and the `notLocal` `reason` says what is happening.

**Tests found unable to fail in this milestone: three**, all three by the review.
1. "every rendering is exercised" — absorbed by the `render()` fallback. Cause: *an assertion
   constrained by something other than what it claims to measure*, here a safety net added fifteen
   minutes earlier in the same milestone.
2. the two consequence tests of `hash.test.ts` — the two merged expressions returned the same value,
   so no behaviour test could turn red. Only the structural guard protects, and my comment credited
   the other two. Cause: *a comment that overstates what protects*. The guard was also hardened — it
   only saw `hashText(`, not the detour through `parse(…).hash` — and it now strips comments from the
   file before searching, so as not to trigger on its own explanation.
3. the 413 and the missing UI bundle — only the **code** was asserted, not the shape, so a
   reappearing `message` key would have passed. Cause: *a fixture that does not reproduce the shape
   of the defect*.

Every fix was **verified red by reintroducing the real defect**, without `git stash`, the file
restored by rewriting and `git diff` checked empty: sixteen mutations in total, including both
directions of the documentation guard, deduplication reduced to the code alone, the four server
bodies with a `message` key put back, the `NEED_NOT_FOUND` `reason` merged again, and the three E2E
assertions with rendering neutralised.

**ADR**: none new. ADR 0002 has its scope line completed; ADR 0003 was used twice to decide reopen /
gap.

**Gaps**: two closed with their proof (`@keelson/server` outside ADR 0002, double hash computation),
two new — the L2 keyboard test comment that overstates its protection, and the lack of `params`
validation at the network boundary, which still lets the word "undefined" be interpolated into a
readable sentence. The latter goes to milestone L8, which opens the API to remote clients and has the
real need for it.

**Dated debt**: none added. **Accepted information loss**: `parseOperation` no longer exposes the full
list of zod `issues`, only the `path` and `detail` of the first — carrying the issues in `params`
would make a public contract depend on zod's internals.

Final verification from a tree **with no `dist/` or `types/` at all**: `bun install
--frozen-lockfile` (133 installs, no changes), `bun run check` → lint 226 files 0 errors,
typecheck 0 errors, **1044 pass / 0 fail**, full build; `bun run e2e` → **35 passed** on the real
binary; binary run under `node v22.16.0` — `validate` renders English, `--format json` exposes
`params` **and** `message`, the help is in English. `grep`: **0 lines of French outside comments** in
`packages/*/src`.

### 2026-10-23 — L2b — the whole milestone

Resume check: clean tree, `main` at `c1c15e4`, `bun run check` green (**1044 pass / 0 fail**). No
divergence between `progress.md` and the repository.

**Step 0 — scoping before any line of code** (`a5dc9e5`). `specs/milestones/l2b.md` sets out GitLab's
`include` semantics **verified against the official documentation**, quote by quote: path from the
repository root, `.yml`/`.yaml` extensions, `*` and `**` wildcards, merge order, precedence of the
last included, no deduplication, 150-file limit. Nine scoping decisions, the ten sites that produce a
diagnostic, and the test layout.

**One accepted divergence from the brief.** It asks for "cycle detection and **maximum depth**, each
with its own code". GitLab documents no nesting depth limit: it documents a **total count** of 150
included files. Inventing a depth would make Keelson stricter than its target — exactly the defect
already recorded as a gap for `MAX_EXTENDS_DEPTH`. The milestone therefore delivers `INCLUDE_CYCLE`,
which actually bounds the recursion, and `INCLUDE_LIMIT_EXCEEDED` on the documented count. Two codes,
each for a bound that exists.

**Two ADRs.** **0005**: the file reader is synchronous, because making `parse` asynchronous would
contaminate `apply` and the whole editing chain for no gain, and because you cannot pre-read what you
discover by reading. **0006**: Keelson **never** fabricates merged YAML — the merge is an ordered
chain of definitions, the one that already resolved `extends` and anchors. A synthetic document would
make every range wrong on disk and in-place editing impossible. That is where the `file` carried by
every IR element and every diagnostic comes from: with several texts, a range without a file no longer
locates anything.

**Steps 1 to 6** (`2d8a159`, `e2ea010`, `6e5b427`, `bc1fa39`, `a97bd8c`, `d29a10c`). GitLab's merge
order falls out of ADR 0006 for free: it is enough to put the definitions in the right order and let
`matches(...).at(-1)` do the rest. `FROM_INCLUDED_FILE` refuses six operations on an included job,
`addStage` and `moveStage` when the list comes from an include, and `renameJob` when an included job
needs the old name. **Two silent defects** that these refusals prevent: `addStage` materialised a
default stage list in the main file, silently overriding the include's; and `addJob` on a name coming
from an include would have written a partial override silently inheriting its keys.

**A defect found by the E2E and by it alone**: `documentLoaded` and the reload set `text` without
setting `included`, so the panel showed "Content unavailable" on a perfectly readable block. Same
class as the `applyPayload` of milestone L2 — a state field updated on only one of the three paths
that feed it.

**The texts of included files travel in the document payload**, not behind the
`GET /api/includes/:file` route the scoping announced. Three reasons, written in the corrected
scoping: the ranges of opaque blocks are offsets into those texts and a separate route would let them
drift apart between two requests; a second disk-read surface would be a second boundary to bound; and
the client cannot request a file outside the resolution, since it requests nothing.

**Step 7 — three independent passes**, all three read-only: a review of the milestone by a sub-agent
that had not seen the implementation, in an isolated worktree, and the two sub-agents of
`/impeccable critique` and `audit`. Repository checked intact on return, no leftover worktree. They
returned **ten reopening findings**, all verified against the evidence before being accepted.

**The worst of the milestone, and it is a security one.** The reader's two boundary checks were
**lexical**, hence blind to symbolic links: `ci/fuite.yml → /etc/passwd` passed both, and the content
of the target file went into the payload sent to the browser, without a single diagnostic. The `.yml`
extension was moreover checked on the **link's name**, never on its target. Opening Keelson on a
repository cloned from a third party was enough to exfiltrate any file readable by the user. And my
comment claimed, at that very spot, that this check was "the last line before a `readFileSync` […]
read by a server that answers a web page". Fixed with `realpathSync` before the prefix check; a link
is still allowed if it stays under the root, because a repository can legitimately contain some and
only the target decides.

**The most humbling is a defect I had fixed, and destroyed myself.** The opaque blocks of an
overridden job were taken from the owning definition alone, so a job defined in an include and
redefined in the main file lost its `script` and its `artifacts` on screen. I had written the fix,
verified its effect, then **one of my file restorations during a red verification silently erased
it** — `git checkout-index` restores the index, and at that moment the index predated the fix. The
regeneration of the goldens then **blessed the regression**: the `override` golden froze
`"opaque": []`. The review found it by reading the committed golden instead of trusting me. Lesson
put into practice: after a series of verification mutations, re-read the **goldens diff** and not
just the test status.

**A third correctness finding**: an `extends` written in the main file beat a value written
**directly** in the include's definition, because the template's sources arrived after the include's
map. GitLab resolves `extends` only after merging, on the merged job: a job's own keys always beat its
templates. The Pipeline view therefore placed the job in the wrong column — the exact class of defect
that motivated ADR 0003.

**The P0 of the `critique` pass, found on my own golden**: `isPartial()` was **false** when a local
include was broken, that is, on the most common defect of a real repository — a typo in a path. The
partial pipeline band did not show, and the screen suggested the pipeline was complete when it was
missing everything that file contributed. The gap I had just closed claimed the opposite. A broken
local include is now **two** things: an error to fix, and a hole in the displayed pipeline.

**Tests found unable to fail in this milestone: five. Three by the review, two by me.**
1. The range assertion of `includes.test.ts` was a ternary that returned the expected string as soon
   as the range existed — it read **no bytes**, and its comment presented it as the guardian of an
   offset. Cause: *an assertion constrained by something other than what it claims to measure*.
2 and 3. Two tests announced as "the measurement on the disk's **bytes**" called `apply`, which is a
   **pure** function: re-reading a file after a call with no side effect is a tautology. The review
   proved it by neutralising every `FROM_INCLUDED_FILE` refusal without turning either red. Cause: *a
   comment that overstates what protects*. They now measure that the result does not claim to have
   changed anything elsewhere, and the byte measurement lives in the server test, where a write
   happens.
4 and 5. Two of the three tests written to cover the defect found by the E2E: the included text was
   identical before and after, so not setting `included` again left the first load's value in place.
   Cause: *a fixture that does not reproduce the shape of the defect*. Found by me, while verifying
   red.

A sixth test was corrected without being inert: the keyboard test of the summary only proved
focusability, `happy-dom` not implementing the native toggle of `<details>`. Expansion is verified in
the real browser, and the unit test's comment now says what it measures.

**The guard a pass made necessary.** `DESIGN.md` states that `border-subtle` is **never** a component
boundary, and L2b had just used it as the border of a job node — measured at 1.26:1 against its
column, so an object that no longer reads as an object. The 1.4.11 guard could not catch it, since it
only tests `border-default` and `accent` precisely because `DESIGN.md` swore the case did not exist.
The added guard measures **usage** rather than contrast: `border-subtle` is only valid with a named
edge. It found **three violations predating the milestone**, all cards at 1.26:1, fixed. A single
named exception: a stage column is a background, not a component, and giving it `border-default`
would make the container compete with its content.

**What the `audit` measured and did not find**, which is information too: zero contrast failures on
**80 texts**, all states included, actual minimum 4.72:1; zero violations of the 11 px floor; zero
horizontal `body` scrolling at 375 as at 1280; zero empty or duplicated accessible names; zero traps
or ghost stops on the keyboard. Its `oklch` → sRGB conversion was checked against Chromium's: zero
difference across the nine tokens. `critique` score: **28/40**, against 20/40 on 2026-10-22.

**Gaps**: three closed with their proof — unresolved `include`s, the partial pipeline indicator, the
severity of `EXTENDS_TARGET_NOT_FOUND` — and **twelve** new ones, including the unresolved include
repeated on two surfaces, the focus ring that is accent-coloured in only one place, the `L³`
approximation of the contrast guard (optimistic for chromatic tokens), and the dev fixture without an
`include`, which means `bun run dev` exercises none of the three delivered surfaces.

**Dated debt**: none added. **Accepted information loss**: GitLab's deep merge is not rendered on the
keys the IR does not model — two files that each define part of an `artifacts:` show the last one's
block. ADR 0006 accepts it: merging it would require fabricating the synthetic document that decision
rejects.

Final verification from a tree **with no `dist/`, `types/` or `*.tsbuildinfo` at all**:
`bun install --frozen-lockfile` (133 installs, no changes), `bun run check` → lint 247 files
0 errors, typecheck 0 errors, **1199 pass / 0 fail**, full build; `bun run e2e` → **44 passed** on the
real binary; binary run under `node v22.16.0` — it resolves a multi-file tree and names
`ci/jobs.yml:6` for a defect that lives there, and it **refuses** the symbolic link that leaves the
root without ever reading its content. `grep`: **0 lines of French outside comments** in
`packages/*/src`.

### 2026-11-04 — L2b-fix

**Why this milestone.** The end-of-L2b report left out four facts: `polish` had not run, a broken
local include downgraded `EXTENDS_TARGET_NOT_FOUND` to a warning, the badge's help text was wrong on
an overridden job, and five post-review fixes had no red proof. The previous log therefore announced
L2b done on a weaker basis than it said.

**Proof method.** Mutation script outside the repository: defect reintroduced, test run, file
restored by rewriting, `git diff` checked empty on that file. Neither `git stash` nor
`git checkout-index`.

**The five requested proofs, all red**: symbolic link (2 tests, two mutations, and 1 server payload
test added, because no test guarded the payload itself); `extends` precedence (1); `isPartial` (4);
opaque blocks (2); help text (1, then replaced).

**Safeguards found untested by probing them**: conditional `Source file`, badge removed from the
included node, sticky lock note. These L2b fixes turned nothing red. Tests added, proven red,
including a geometry E2E for `sticky`.

**Severity** (ADR 0007, decided by Khalid). `error` for a broken local include, `warning` for an
include that could not be read. `Pipeline.unresolved` no longer decides the severity.

**Help text.** It depends on the job and the origin, three sentences. My first fix only looked at the
origin: it refused a possible override and promised an impossible one on an included job inherited
through `extends`. The override promise is held by a test on `apply`.

**`/impeccable polish`**, run on a stress tree, at 1280 and 375 px. One real defect: my bound on the
partial band was worthless, 729 px out of 800 and 2751 px on mobile with 31 includes. Bounded to a
third of the screen. Also: red border on the disabled "Delete job", rule under the sticky note, tag
weight, and the sentence "does not exist in this file", wrong since includes.

**Independent review: 5 reopening findings.** All reproduced by a red test before being fixed.
- A main file linked outside the root went out unchecked, through the path `reader.ts` did not cover:
  the same exposure as the included link, verified on the binary. It goes through the reader.
- A short-form URL was a broken local path. **Regression created by this milestone**: the new rule
  turned it into an `error`.
- `setJobStage` wrote `stage: !reference test`.
- **A `!reference` did not cross files**, although the L2b brief required it and its scoping
  announced the `reference-across/` fixture, never created. My comment presented this limit as a
  GitLab rule.
- The help text was only tested on Stage.
Three gaps fixed along the way because they contradicted a comment or a rule: what the 150 limit cuts
makes the pipeline partial (my comment said the file was read); a link target must be YAML; the
"Delete job" border is checked on the computed style.

**Counter-review of the fix: 3 reopening findings and 2 regressions from that same fix.** `!reference`
crossed neither aliases nor merge keys and returned the losing value; the order was wrong for a file
included twice; `setJobStage` failed on the block form; the watcher went silent on a main file turned
into a refused link; a FIFO froze startup. Fixed and proven red. Without this second pass, the
milestone would have merged these defects.

**Tests found unable to fail: 6**, all by the reviews or the probes.
1. to 3. `Source file`, node badge, `sticky`: no test. Cause: *a review fix merged without a red
   proof*.
4. and 5. Help text on Needs and Environment. Cause: *a fixture that only covers one branch*.
6. "Delete job" border: assertion on a class string, replaced by the computed style. Cause: *an
   assertion that measures the source and not the render*.
The false negative of my script (`NO FAILURE` printed on a red test, filter too strict) and a test
committed on a red base because of a missing import were fixed before any conclusion: the affected
proofs were redone from a green base.

**ADR**: 0007. **Dated debt**: none. **Gaps**: 12 new, including two wrong writes to take up at the
start of L3, and the 2026-10-20 line on cross-project needs corrected, as it claimed that editing
never rewrites the whole list. `specs/autopilot.md` completed.

**Deliberately left untreated**: the rare forms of `setJobStage`, `keelson validate` without the
reader, and `writeAtomic` through an internal link, all recorded.

Final verification from a tree with no `dist/`, `types/` or `*.tsbuildinfo`:
`bun install --frozen-lockfile` (133 installs, no changes), `bun run check` → lint 248 files
0 errors, typecheck 0 errors, **1236 pass / 0 fail**, full build; `bun run e2e` → **46 passed**;
`KEELSON_FC_RUNS=500` on the properties → 18 pass; binary under `node v22.16.0`: a broken local
include returns `INCLUDE_NOT_FOUND` and `EXTENDS_TARGET_NOT_FOUND` as `error`, on the right file,
exit 1.

### 2026-11-04 — L3

**Delivered.** `@keelson/taxonomy` (13 OWASP layers, 8 platform categories); `@keelson/catalog`
(62 catalogue entries, compiled into a committed `catalog.json`, detection on `image` and `script`,
override through `.devsecops/layout.json`); `Job.signals`; `/api/catalog`, `coverage` in the
payloads, `coverage.changed`; Coverage and Catalog views, reading posture, catalogue entry page;
`keelson coverage` and `keelson catalog lint`. ADR 0008. Eleven gaps closed in the milestone, each
with its proof in `specs/gaps.md`.

**Independent review.** Eight reopening findings, all fixed (`ecf83e4`). `critique` and `audit`: one
P0 (invisible emphasis) and six P1, fixed (`d22b63a`). Seventeen red proofs; sixteen held.

**Test unable to fail.** "A global script does not exist" had no top-level `script` key in its
fixture: the mutation stayed green. Rewritten, proven red. An `__proto__` override test was inert
because zod strips the key: deleted, along with the code.

**Limit of `catalog lint`.** All 62 entries carry `lastVerified: 2026-11-04`: the freshness check only
fires on test fixtures with a fixed `now`, never on the real catalogue before May 2027.

**`polish`.** Catalogue columns named while scrolling, E2E red then green.

**`document`.** `DESIGN.md` and its sidecar up to date, gap closed. The pass noted that the filter
grid contradicted ADR 0008: fixed without a breakpoint rather than widening the ADR. `CoveragePanel`
sections turned into groups, licence alone in monospace. The accent links `See tools` and `Homepage`
are accepted under the Attention Accent Rule.

**Counter-review of the fixes.** Four reopenings:
1. `reloadCoverage` swallowed `document.changed` and `document.removed`, a regression from `ecf83e4`;
2. a stale response to `coverage.changed` overwrote the coverage of an operation;
3. `bash -c "trivy …"` and `(trivy …)` were no longer detected, a regression from the same review;
4. the ZAP snippet's image was not recognised by its own entry. Root cause guarded by an invariant
   over the whole catalogue: every GitLab snippet image is recognised by its entry.

Also handled, because the effective value is a D1 promise: `inherit` and `image` merged across
`extends`, `trigger` job without signals. Handled because wrong: the CLI's `partial` message, the
`file` of `COVERAGE_LAYER_MISSING`, the Tool column at 48 px at 375 px. Six red mutations, `git diff`
empty after each. Bounds of shell detection and minor items: `specs/gaps.md`.

**Second and third counter-reviews, each on the previous one's fix.** The tally shows why the rule
exists: `inherit` wrongly merged across `<<`; a `coverage.changed` guard that left a second tab
behind; `entryAt`, now called on every job, crashing on `job: &a` + `<<: *a`, to the point of killing
the server under Node; a false alert and a lost undo during an in-flight operation; then a due reload
forgotten if that operation failed without a 409. Each fixed, proven red. The watcher now absorbs
parser exceptions, and `entryAt` shares its set of visited maps, which makes diamonds linear. The
cycles that still throw outside `entryAt` are recorded.

**Fifth and sixth counter-reviews.** The fifth showed that the watcher's `catch` left the store on the
old text: an operation then replaced the broken file. The unreadable document is now forgotten,
operation answered with 500 and no write, two tests proven red. The sixth, on that change alone and
on the Node binary, reopens nothing.

**A method error.** The switch to `role="group"` was committed without running the lint; the
verification from a clone caught it. `bun run check` passes before a fix is considered done.

**Closure.** Merge `36caaa1`. From a clone without `dist/`: `bun run check` 1443 tests, properties at
500 runs, 56 E2E, Node smoke test (`validate`, `coverage`, `catalog lint`, `start`). `check` green on
`main`.

### 2026-11-05 — L4

**Delivered.** Toolchain model and operations in `core`; `.devsecops/toolchain.yaml` read, validated
and edited in place, four fast-check properties on a corpus of twelve files; `integration` field on
service entries, proposals never written on their own, `dismissed`; coverage per declared service;
positions in `layout.json`; routes `/api/toolchain`, `/api/toolchain/operations`,
`/api/layout/positions`, `toolchain.changed` event; `keelson validate` and `coverage`; Toolchain view
with panel, service panel and history. ADRs 0009 to 0011. Gaps closed: re-reading the disk before
writing (including for the CI file), `scm` never covered.

**Independent review: the milestone was not mergeable.** Ten findings, including five wrong writes
that properties green at 500 runs did not see:
1. a `|` or `>` scalar at the end of a value swallowed the next line, hence a whole service or
   section;
2. `services: ~` left `~` stuck to the last inserted value;
3. an update on an anchor changed its aliases;
4. an unreadable file counted as an empty file, then was overwritten;
5. an internal link was replaced, a non-UTF-8 file corrupted.

**Tests unable to fail.** The properties returned green on any refusal: an `applyToolchain` that
refuses everything passed at 500 runs, and the corpus contained no block, no `~`, no anchor. Fixed
with an adversarial corpus and a closed list of expected refusals. `applyToolchain` now re-reads its
result against a model computed without the text, and refuses if they diverge: an unforeseen YAML
shape becomes a refusal, never a wrong write.

**Also.** `PUT` of positions merged rather than replaced, a JSON `null` body that left a request
unanswered on all three routes, three store races.

**`critique` and `audit`.** Five P1 fixed: Escape and focus, Backspace removing a node from the
screen, invalid state presented as empty, decisions invisible below `lg`, graph unreadable outside
the nominal case, edges unreachable from the keyboard (the service list carries them). This pass did
not run a browser: its frame forbids it. The overflow measurements at 320, 768 and 1024 px were
therefore not made by it; the E2E covers 375 px.

**`polish`.** Screenshots at 1280 and 375 px after fixes, with no new finding.

**`document`.** No token changed. `DESIGN.md` gains the Toolchain view and the meaning of the dashed
line.

**A method error.** An L4 commit (`ffeb4e3`) went out with a failing test, because the output was read
after the `git commit`. The next one fixes it. The sequence is `bun test`, then commit only on zero
failures.

**Counter-reviews.** Five passes, each on the previous one's commit. They found: the echo of a write
taken for an external change while `Ctrl+Z` was held; a `written` that never expired and left the
screen wrong; a vanished job written anyway; focus stolen mid-input; `8080:` and `"8080":` causing a
write into an invisible entry. All proven red, E2E included. The last one reopens nothing blocking,
and its single remainder is recorded. The first attempt at proving the focus guard had no reliable
exit code: redone with a script that returns Playwright's.

**Closure.** Merge `fd63570`. From a clone without `dist/`: `bun run check`, properties at 500 runs,
68 E2E, Node smoke test. `check` green on `main`.

### 2026-11-05 — L5

**Delivered.** `addSnippet` and `composite` with a single inverse (ADR 0012), properties extended;
`POST /api/documents/:file/preview`, side-effect free; `Add to pipeline` in the catalogue entry page,
semantic diff before writing, covered layers, undo in one step; `keelson export`, `markdown`,
`mermaid`, `json`, documented in `specs/export.md`; shell splitting for detection. Gaps closed:
cross-project needs, script splitting.

**Left open, with their reason.** Running the snippets in a container: no runner here. `:debug`
variants of the four images: not verified against the evidence. GitLab Secure analysers: no
catalogue entry carries them.

**`critique` and `audit`, this time with a browser.** One P0: `scan_type="Trivy Scan"` in the
DefectDojo snippet made SCA, IaC and Infrastructure count, and `coverage --require sca` exited with 0
without any scanner. Fixed, and guarded by an invariant over the whole catalogue: a snippet only
claims the layers of its entry. Seven P1 fixed: truncated diff, unreadable primary action, no
feedback after writing, lost focus, Undo hidden below `lg`, invisible write failure, diff without
semantics.

**A step back.** Scrolling of the snippets, delivered to close a gap, made them unreachable from the
keyboard and contradicted `DESIGN.md`: removed, gap reopened.

**Independent review.** Nine reopenings: `Insert` wrote a name the diff did not show, the preview
swallowed `document.changed` while advancing the hash, an indented snippet was written into the
previous job, an empty `stage` produced `test# c`, cross-project needs behind an anchor were still
lost (the gap had been wrongly declared closed), `addStage` copied an anchor, Mermaid lost the jobs of
an undeclared stage and let `%%{init}%%` through, and 6 KB of `$(` crashed the CLI. It also found the
cause of the E2E flakiness: an assertion already true before the action.

**Three method errors.** `pkill -f` killed my own shell, which the L2b log had already noted. A first
fix of `unmodelledNeeds` marked every job with `needs`: `entryAt` returns `null` outside a map, and
the goldens caught it without being regenerated.

The third: the red proof of the shell splitting bound hung, as expected, and its `timeout` killed the
script before the restoration. The mutated file went into log commit `5db58c3` through `git add -A`,
spotted on re-reading and fixed in the next commit. A mutation that may not finish is run without a
`timeout` outside the script, and `git add -A` never follows a mutation without checking the tree.

**Counter-reviews.** Six passes. The first ones found a form stuck after a 409, false positives and a
regex blow-up introduced by the shell fix, then a blow-up in the `needs` traversal. Word-by-word
matching replaced the regex, and an allowlist replaced the traversal: only what the IR renders
identically is rewritten, and the re-read list is compared with the expected list. The last one
reopens nothing.

**Closure.** Merge `971ae5b`. From a clone without `dist/`: `bun run check`, properties at 500 runs,
71 E2E, Node smoke test, `export` included. `check` green on `main`.

### 2026-11-05 — L6

**Delivered.** `adapter-github`: reading and writing workflows, stages derived from `needs` (ADR
0013), `uses:` flagged by `WORKFLOW_UNRESOLVED`, a corpus of 22 files from `actions/starter-workflows`
at a pinned SHA, licence read from the commit's `LICENSE` (MIT with a sentence on trademarks);
`detect.actions` on thirteen catalogue entries, repositories verified; `adapterFor`, multi-file
workspace, `mergePipelines` for the toolchain and the CLI; file picker, surfaces without stages,
`github` snippets.

**Independent review: thirteen reopenings.** The heaviest: `renameJob` left `if: needs.build` pointing
into the void, a folder without `.git` read workflows with the GitLab adapter, a job with the same
name in two workflows erased a coverage, `upload-sarif` counted as CodeQL, the watcher only notified
the last file, switching files during a write mixed two documents, and `level 1` could end up in
`.gitlab-ci.yml`. The re-read now covers everything the operation does not target: shortened `|+`,
an alias that changes target, an anchored key are refused.

**`critique` and `audit`.** Five P1, all handled: select active during a write, form surviving a
change of provider, coverage of a single file without saying so, `NoCiFile` promising a reload,
`implicit` badge wrong on GitHub.

**Counter-reviews.** Four passes. `citesJob` took the most work: brackets and case escaped a regex on
the text, then reading every value refused ordinary sentences, then cutting at the first `}}` missed
`format('{{0}}', …)`. The check reads each `${{ … }}` up to its `}}` outside strings, in values and
keys, plus every `if` value (state at `226b88d`, reviewed on 2026-11-11, see below). Six surfaces
without proof (`descendants`, `scope`, notice, `opening`, `reload` guard) received a test.

**A method error.** The `feat(adapter-github)` commit went out with a test typing error, read after
the `git commit`. Fixed in the next commit.


### 2026-11-11 — L8 — `keelson apply`

Scoping in `specs/milestones/l8.md`, written from `main` at `f044143`. L6 remains the current
milestone, L7 still to do: L8 was carried out in parallel, on a separate branch, because it only
touches the CLI.

**Delivered.** `keelson apply <ops.json> [<repo>...] [--file] [--rebase] [--dry-run] [--json]`. The
operations file is validated in full by `parseOperation` before the first repository: unreadable
JSON, an empty array or an invalid operation exit with 2, the index named (`operations[1]: …`), the
text rendered by `@keelson/core/messages`. Each repository is handled on its own: the sequence is
applied in memory, each operation on the `document` returned by the previous one, and the file is
written only once, by `writeInsideRoot` (now exported by `@keelson/server`), if the whole sequence
succeeds. `--rebase` re-anchors each `baseHash` on the current text; without it, a repository whose
text differs returns `STALE_DOCUMENT` and the others are written. `--dry-run` returns
`+n -m line(s)`, the new hash and a `-U0` diff. `--json` returns `{ results: [...] }`, with `code`,
`params`, `kind` and the index for an operation error.

**Boundary.** The target file is read by `readInsideRoot`: a `--file ../x` and a link pointing
outside are refused without reading or writing, two tests. `include`s go through `createFileReader`
on the repository root: a `removeJob` on an included job returns `FROM_INCLUDED_FILE`, not
`JOB_NOT_FOUND`.

**TDD.** `packages/cli/test/apply.test.ts` and the command lists of `run.test.ts` written first: 30
failures out of 41 before any implementation. The two-hunk diff test, added afterwards, is proven by
mutation. Two mutations after the fact: removing `--rebase` fails 1 test, hunk numbering in the diff
fails 3. Tree restored and checked after each.

**Commands.** `bun run lint` and `bun run typecheck`: 0 errors. `bun test packages/cli`: green except
`serves the UI bundle embedded in dist/ui`, which requires `dist/ui` and passes under
`bun run check`. `bun run check`: **1803 pass / 4 fail**, the four failures being the server's
pre-existing `chmod` tests, which fail because the container runs as root.

**Gaps.** Four, dated 2026-11-11: `baseHash` still required under `--rebase`, two diffs with the same
algorithm, no re-read of the disk before the `rename`, GitLab only. **Dated debt**: none.
**ADR**: none, the decisions of form are in the scoping.

### 2026-11-11 — L7, and a second, abandoned implementation of L6

A read-only implementation of L6 was first written on `claude/wonderful-edison-vituwb`, from
`f044143`, without seeing `lot/l6-github`, which had not been merged. It is **replaced** by
`lot/l6-github` at the merge (see below): its conflicts were resolved in favour of that branch, and
its error code `READ_ONLY_ADAPTER`, left without an emitter, is removed.

**L7**: English README, `CONTRIBUTING.md`, `SECURITY.md`, `packages/cli/README.md`, publishable
manifest (`0.1.0`, no runtime dependencies, repository, keywords, provenance) guarded by
`packages/cli/test/publish.test.ts`, `release.yml` workflow on `v*` tags. Tarball verified with
`npm pack` then `npm install` and execution under Node.

**Verification**: `bun run check` green except the 4 known `chmod` tests, which fail only because
the container runs as root; `bun run e2e` 73 / 73.

### 2026-11-11 — clean-up before presentation

Read-only audit on five axes (hygiene of tracked files, documentation consistency, code, build and
CI, first impression), each proposal reviewed by an adversarial verifier. Applied:

- `keelson <command> --help` shows the command's usage instead of "Unknown option" (test first);
- npm package: `LICENSE` and `THIRD_PARTY_NOTICES.md` (34 components, elkjs under EPL-2.0), the test
  recomputes the bundled dependencies and requires each one with its licence;
- `packages/ui/.impeccable/review/` untracked (the 2026-10-22 gap is closed), obsolete `.gitkeep`
  removed, dead Playwright `baseURL` removed, binary CI on Node 20, 22 and 24;
- issue and PR templates, `specs/README.md`, `autopilot.md` marked archived;
- README: getting started from source verified, badges, diagram, exact command usage, roadmap; stale
  gaps closed or deferred to a milestone to be defined; `findJob`, a dead export, removed.

Not done, left to the owner: `CODE_OF_CONDUCT.md`, which requires a moderation contact.

### 2026-11-11 — merge of `lot/l6-github`

`lot/l6-github` (complete L6: reading **and** editing workflows, corpus of 22 MIT workflows from
`actions/starter-workflows`, fast-check properties, ADR 0013) merged into
`claude/wonderful-edison-vituwb`. Conflicts resolved in favour of `lot/l6-github` for all the GitHub
code; L7, L8, `--help` and the clean-up kept on top. `apply.ts` (L8) reads `DEFAULT_FILE` from
`analysis.ts`. Two tests of the abandoned version, contrary to the choices of `lot/l6-github`, are
removed: the read-only label and the integration inferred from an action (moved to the gaps).

### 2026-11-11 — counter-review of `226b88d`

The counter-review left pending on `lot/l6-github`: three independent reviewers (correctness, tests
unable to fail, contracts), each finding reproduced by three sceptics in their own worktree, majority
required. Nine findings confirmed, none refuted, reduced to four:

- **Regression**: the dynamic `needs` was read everywhere, so `'needs-review'`, `env.NEEDS` or
  `matrix.needs` refused renaming and deleting every job. Only the root of the context counts now,
  after neutralising `'…'` strings.
- **Hole**: `jobs[inputs.x]` and `toJSON(jobs)` in the outputs of a reusable workflow were not seen;
  they are refused.
- **Scope**: a job's `needs` only contains its own needs; a `toJSON(needs)` now only protects those,
  instead of every job in the file.
- **Contract**: the dynamic refusal has its reason, `dynamicExpression`, documented in
  `diagnostics.md`, instead of saying a job is cited when none is. Tests added for several `${{ }}`
  in one value, the literal index `needs['z']`, and removeNeed and removeJob.

`adapter-github` and `adapter-gitlab` properties at `KEELSON_FC_RUNS=500`: 673 / 673.
