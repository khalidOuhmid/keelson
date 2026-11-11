# ADR 0004 — No write without an explicit action

Date: 2026-10-22 · Decided by: the autopilot · Status: accepted

## Context

The `/impeccable critique` pass of 2026-10-22 scores error prevention at **1/4** and identifies two
paths through which Keelson rewrites the user's file without the user having asked for a write.

The first is the more serious because it is invisible. The stage `<select>` submitted
`setJobStage` on `onChange`. On Windows and Linux, arrow keys in a **closed** `<select>` fire
`change` on every keypress: a keyboard user browsing the options to **read** them rewrites their
YAML once per key. Moving down three options produced three operations, three atomic writes and
three history entries. The user had chosen nothing.

The second is visible but irreversible in one gesture: `Delete job` rewrote the file on a single
click, with no confirmation, without naming what depended on the job. Undo exists — Ctrl+Z — but
is documented nowhere on screen, and `PRODUCT.md` makes not destroying the file the product's
central proposition.

Both share a cause: the UI treated a **control state change** as an **intent to write**.

## Options

1. **Keep the select and add a `debounce`.** Reduces the number of writes without removing the
   class of defect: browsing the options still writes, just less often. And the last state browsed
   becomes the one written, which is worse — the user stops on an option while reading it, and that
   is the one that gets sent.
2. **Replace the `<select>` with a non-native control.** Removes the symptom by giving up a native
   affordance the brief explicitly asks to keep, and creates an accessibility surface to maintain by
   hand.
3. **Separate choosing from committing**, for everything that writes.

## Decision

Option 3. A single rule, held everywhere in the UI:

**A control that changes a value never triggers a write. The write comes from a named action whose
label says what is about to be written.**

- The stage `<select>` feeds local state. A **"Move to stage"** button submits, and stays inert as
  long as the displayed stage is the job's current one.
- `Delete job` opens a `role="alertdialog"` confirmation that **names the job** and **lists the jobs
  that depend on it**, computed from the pipeline. The confirm button is labelled
  **"Delete <job>"**, not "OK": the label is the last chance to see what you are doing.
- Outside this rule remain the actions whose intent is already carried by the action itself:
  `Add stage`, `Add need`, `Rename`, `Create job`, `Set environment`. These are buttons; they never
  wrote on a mere value change.

## Consequences

- The keyboard path **gains one step** for moving a stage and for deleting. This is deliberate: the
  extra step is what turns browsing into a decision. The keyboard E2E tests check that the
  confirmation is reachable and can be passed without a mouse.
- Three tests that pinned the old behavior are rewritten rather than deleted — they describe the
  same user intent with the explicit action. An E2E test additionally checks that the file on disk
  **has not changed** until the confirmation is passed.
- The confirmation computes the referencing jobs **client-side, from the pipeline**, and does not
  replace the server's `JOB_REFERENCED` refusal, which remains the authority. The client warns, the
  server decides. An E2E test still covers the case where the server refuses after confirmation.
- This rule will extend to later milestones: L4 (toolchain) and L5 (job insertion) add controls that
  write, and they inherit the choose / commit separation without reopening it.
- Known limit, not addressed here: once the write is done, nothing yet says **what** was written.
  Showing the diff from `touched` is a new surface, recorded as a gap under ADR 0003.
