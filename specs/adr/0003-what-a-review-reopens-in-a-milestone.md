# ADR 0003 — What a review reopens in a milestone

Date: 2026-10-22 · Decided by: the autopilot · Status: accepted

## Context

The `/impeccable critique` pass of milestone L2 (step 9) scored **20/40** and raised three P0
defects. Two of them are not polish defects but **correctness defects in steps already delivered
and already committed** in the same milestone:

- the Pipeline view draws `lint`, a job of stage `test`, inside the `build` column, whose header
  says "1 job" — on the project's dev fixture, in the delivered screenshot (step 3);
- `JobEditor` is mounted without a `key`, so the local state of a selected job survives selecting
  the next one: the "Job id" field offers the old name, and `Rename` rewrites the YAML with a value
  the user never typed (step 5).

Both were green in tests. `layout.test.ts` and `graph.test.ts` check that the layout is
**computed**, never that it is **true**; no test mounts `JobEditor` twice with two different jobs.

The steering rule says: "anything outside the scope of the current milestone goes into
`specs/gaps.md`, never into the milestone". Applied to the letter, it would send these two defects
to the gaps and allow L2 to be merged knowing that its main view shows a job in the wrong column.

## Options

1. **Everything to the gaps, merge L2 as is.** Respects the letter of the rule. Merges into `main`
   a view that lies about the very data it exists to show, and an editor that can rewrite a name the
   user never entered. The gaps file would become the place where we put what we don't want to fix,
   which empties it of its meaning.
2. **Handle everything in L2.** Includes full keyboard navigation of the graph and showing the diff
   after a write, which are new interaction surfaces requiring a `shape` pass. The milestone would
   no longer have an edge: every review would add a piece to it.
3. **Decide by the nature of the defect, not by its discovery date.**

## Decision

Option 3. The criterion is **what the milestone promised**, not when the defect appeared.

- **Reopens the milestone**: any defect that makes an already delivered step *fail to deliver what
  it announced* — the view shows something wrong, editing writes a value that was not entered, a
  rendered control is dead, a state declared load-bearing by the surface brief is not rendered, an
  explicit commitment of `PRODUCT.md` (WCAG 2.1 AA) is not met. These are `fix:` commits under TDD
  in the milestone branch, failing test first.
- **Goes to the gaps**: any **new interaction surface**, even if the review deems it desirable —
  arrow-key graph navigation, command palette, search, showing the diff after a write, read-only
  posture. These subjects require an `/impeccable shape` pass before being coded, and `shape` opens
  a milestone, it does not finish one.

The dividing line, in one sentence: **a review may reopen a promise, never add one.**

## Consequences

- The "out of scope → gap" rule now reads: out of scope means *not promised by the milestone*, not
  *discovered late*. `specs/gaps.md` remains the register of what is deferred, never of what is
  abandoned.
- L2 cannot be merged until the defects of the first category are fixed, test first. Its definition
  of done in `specs/milestones/l2.md` is therefore extended by one item: *no open defect of the
  "broken promise" category*.
- A layout invariant test is added: the center of every job node falls inside the box of **its**
  stage's column, checked across all fixtures. The P0 column defect was born of tests that checked a
  computation without checking a truth; that class of test was what was missing, not a particular
  case.
- Accepted consequence: milestones get longer when a review is harsh. That is the price of "final
  mode, no POC". A merged milestone must be fit to show.
