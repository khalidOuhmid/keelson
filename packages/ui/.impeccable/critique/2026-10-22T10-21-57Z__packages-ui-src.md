---
target: packages/ui/src
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-10-22T10-21-57Z
slug: packages-ui-src
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | `KeelsonState.pending` is set on every submit in `state/store.ts:116-118` and read by **zero** components. No spinner, no disabled control, no feedback until the response lands. The surface brief names "pending operation in flight" load-bearing; it is unimplemented. |
| 2 | Match System / Real World | 3 | GitLab vocabulary preserved exactly. Lost a point for "Opaque blocks" (internal code name surfaced to users) and French `core` diagnostics in an English panel (closed by ADR 0002, lot L2c). |
| 3 | User Control and Freedom | 2 | Undo/redo is real. But the detail panel **cannot be closed without a mouse**: `onSelectJob(null)` fires only from a click on empty canvas, no Escape handler, no close button. No cancel for an in-flight operation. |
| 4 | Consistency and Standards | 3 | Strong token discipline inside components, broken at the screen level by React Flow's default edge and background colours, by `✕ ! i ↳ ← →` as icons, and by uppercasing user-authored identifiers. |
| 5 | Error Prevention | 1 | The Stage `<select>` in `editing/JobEditor.tsx` submits `setJobStage` on `onChange`, so a keyboard user arrowing through the options rewrites the YAML once per keypress. Delete job rewrites the file on one unconfirmed click. |
| 6 | Recognition Rather Than Recall | 2 | `JobEditor` initialises `environmentName`/`environmentUrl` to `""` even when the job has an environment: the panel above reads `name: production` while the editor below shows two blank boxes. |
| 7 | Flexibility and Efficiency | 2 | Ctrl+Z / Ctrl+Shift+Z are the entire keyboard story. No command palette, no job search, no arrow-key graph traversal, no multi-select. Against the stated Linear/Raycast bar — products that are keyboard-first — this is keyboard-tolerant. |
| 8 | Aesthetic and Minimalist Design | 3 | The restraint is real and well-judged: five surface steps, one accent, no shadows. Lost a point for the permanently mounted diagnostics band reading "No diagnostics." and ~600px of dead sidebar. |
| 9 | Error Recovery | 2 | `ErrorBanner` showing code + message + `referencedBy` chips is genuinely good. But its Dismiss button is wired to `dismissNotice()`, which sets `notice: null` and never touches `error` — **the banner cannot be dismissed**. |
| 10 | Help and Documentation | 1 | The product's central safety guarantee is a `title` attribute. No legend for dashed vs solid edges, no explanation of what an opaque block is, no hint that `implicit` means GitLab inferred the stage. |
| **Total** | | **20/40** | **Acceptable — bottom of band** |

The visual craft sits well above 20/40. The score is dominated by missing feedback, missing
confirmation, and two outright dead controls.

## Design Specificity Verdict

**LLM assessment.** Specific in one place, interchangeable everywhere else — and the one specific
place is undersold. Strip three strings out of `app.tsx` and this is a generic DAG workbench. That
is partly the committed direction ("the category standard, played straight"), which is a licence for
the *layout* to be conventional, not for the product's reasoning to be invisible. Keelson's four
unforgeable claims — origin of every value, byte-for-byte preservation, minimal diff, OWASP
coverage — have pixels devoted to exactly one.

**The origin badge, named by the surface brief as the memorable moment, does not land.** It is
louder than the value it annotates (190px badge against a 48px value); it applies `uppercase` to a
case-sensitive YAML key the user wrote, rendering `.deploy-base` as `.DEPLOY-BASE`, which breaks
both the Monospace-Means-File rule and the Small-Caps Label rule in DESIGN.md; and `ORIGIN_HINT`,
the sentence that is the entire reason the badge exists, is a `title` attribute reachable only by a
sighted mouse user who hovers and waits.

**Structural sameness.** Every grouping in the product is the same object: a section with a 10px
uppercase muted heading over a 6px-gap stack. A section heading ("Needs") and a field label inside
it ("Add a need") are typographically identical — `controls.ts` `LABEL` serves both. One voice,
therefore no hierarchy.

**Off-system marks on the primary surface.** The canvas dot grid and the edge strokes are React
Flow's stock greys, inherited wholesale from its stylesheet with no override. The two most-repeated
marks on the main view are outside the design system. `--keelson-edge-width` and
`--keelson-edge-width-strong` are defined and consumed by nothing — their absence *is* the missing
edge styling.

**Deterministic scan.** `detect.mjs --json packages/ui/src` → exit 0, zero findings. Verified not to
be a silent no-op: `.tsx`/`.ts` are in scope, no ignore rules exist, and a synthetic control file
produced exit 2 with `overused-font` and `bounce-easing`. The static engine covers ~5 of 59 rules on
source files; the other 54 are browser rules, and that is where the signal is.

**Visual overlays.** Injection succeeded (mutable `document.title` and an executing `<script>`), the
Impeccable live server served `detect.js`, and the in-page detector reported **14 anti-patterns at
both viewports**. Twelve collapse to one root cause: `--text-2xs: 10px` (`tokens.css:42`) sits below
the 11px functional-text floor, so all 16 of its call sites trip `undersized-ui-text`. Of the other
two, `text-overflow` on `OriginBadge.tsx` is genuine (the span carries `max-w-full truncate
whitespace-nowrap` and still overflows by 28px). Both servers were stopped and verified down.

**False positives, discounted.** `overused-font: roboto` is an environment artifact — `--font-sans`
is a system stack and Roboto is its fifth entry, which only won because this headless Linux box has
no earlier match. `clipped-overflow-container` on `div.react-flow` is library-owned and required for
the pan/zoom canvas. The mobile `flat-type-hierarchy` reading (1.8:1) measures the overlay's own
injected banner; the desktop reading (**1.3:1**, sizes 10/11/12/13px) is the trustworthy one.

## Overall Impression

The refusal paths are excellent and the token system is unusually disciplined — this is careful
work. But the product reassures you when it *doesn't* touch your file and goes silent when it does,
and the graph is currently drawing a job in the wrong stage column on the project's own dev fixture.
The single biggest opportunity: the write loop. `touched: SourceRange[]` comes back from the server
on every successful operation and is discarded. For a product whose first principle is that every
interaction is judged on the diff it produces, the user must alt-tab to `git diff` to learn whether
Keelson did what they asked.

## What's Working

1. **Refusal copy and refusal states — the hard part, done well.** `InvalidDocument`,
   `DocumentRemoved`, `NoCiFile` and the 409 path each name the file, name what happened, state the
   consequence for the file on disk, and say what happens next, in plain sentences. `NoCiFile` echoes
   the path it searched. `ErrorBanner`'s `referencedBy` chips turn an abstract `JOB_REFERENCED`
   rejection into "these three jobs point at it".

2. **Tokenised geometry is a real idea, not a slogan.** `views/pipeline/metrics.ts` reads
   `--keelson-node-width`, `--keelson-column-gap` and `--keelson-row-gap` out of CSS at runtime and
   hands them to elkjs, with a `length()` that **throws** on a missing token rather than silently
   defaulting. Node geometry and node styling cannot drift apart — the failure mode of every
   hand-rolled graph UI.

3. **Never-hue-alone is implemented, not merely documented.** `DiagnosticsPanel` marks the glyph
   `aria-hidden` and ships the severity *word* beside it; `NoticeBar` carries "Not applied" /
   "Reloaded" / "Deleted" in a `border-current` chip, and splits `role="alert"` for consequential
   notices from `role="status"` for informational ones.

## Priority Issues

### [P0] The stage columns do not contain their own jobs

**What.** Visible in `.impeccable/review/desktop.png`: the `build` column header reads "1 job" while
two cards sit inside its box — `build-image` (stage `build`) and `lint`, whose own subtitle reads
`test`. The `test` column reads "2 jobs" with an empty top half. Root cause in
`views/pipeline/layout.ts`: a column's `x` is inferred from the x of whichever member node elkjs
happened to place first, with an `index * (nodeWidth + columnGap)` fallback. Nothing ties box
geometry to partition geometry, so when elkjs's layer assignment disagrees with the stage partition —
which it does for an edgeless node like `lint` — a column box lands on top of another column's nodes.

**Why it matters.** The one job the Pipeline view has is to say which job runs in which stage. It is
saying the wrong thing, in the shipped screenshot, while the header count beside it says the
opposite. A platform engineer who trusts this reads their pipeline wrong. It also invalidates the
known re-fit issue: refitting the view would faithfully reveal a wrong layout.

**Fix.** Derive each column's `x` and `width` from the partition itself, and add a layout invariant
test asserting every job node's centre falls inside its own stage column's box, run over the whole
fixture set.

**Suggested command:** none — this is a defect. Fix under TDD before polish; polish on a wrong graph
is wasted work.

### [P0] Selecting a second job carries the first job's editor state

**What.** `app.tsx` renders `<JobEditor job={selected} …>` with **no `key`**. React reuses the
instance across selections, so `JobEditor`'s `useState(job.id)`, `needTarget`, `optional`,
`artifacts`, `environmentName` and `environmentUrl` run only on first mount. Select `build-image`,
then select `unit-tests`: the panel header says `unit-tests`, the Job id field still says
`build-image`, and clicking Rename submits `renameJob("unit-tests", "build-image")`.

**Why it matters.** This is the file-corruption class. The user's YAML is rewritten with a value they
did not enter, on a control they did not realise was stale, in a tool whose whole proposition is "I
will not damage your file."

**Fix.** `key={selected.id}` on `<JobEditor>`, and make the environment fields controlled from the
job rather than from blank local state so the editor always reflects the file.

**Suggested command:** none — correctness bug, `fix:` commit under TDD.

### [P0] The write loop has no feedback, no confirmation, and no diff

**What.** Three gaps in one failure. (i) `pending` is maintained in the store and rendered nowhere;
every control stays enabled and double-submits. (ii) Delete job rewrites the file on a single
unconfirmed click. (iii) `OperationPayload.touched` arrives on every success and is discarded in
`applyPayload`.

**Why it matters.** The surface brief names the pending state load-bearing. PRODUCT.md's first
principle is that every interaction is judged on its diff, and the UI never shows one. The user's
only feedback that Keelson did anything is that the graph silently re-laid itself out.

**Fix.** Render `pending` (disable the editors, show a hairline progress state). Confirm Delete job,
naming the job and what needs it — the `referencedBy` machinery already exists. Surface `touched` as
a transient "2 lines changed in .gitlab-ci.yml" chip.

**Suggested command:** `/impeccable shape` for the write-confirmation moment, then
`/impeccable polish`. This is a missing interaction, not a mis-finished one.

### [P1] Every interactive border fails WCAG 1.4.11, and selected job subtitles fail 1.4.3

**What.** Computed from `tokens.css` and re-verified independently: `border-default` — the border on
every input, select, textarea, button, tag and unselected job node — scores **1.63:1** against
`surface-1` against the 3:1 required for UI component boundaries. `text-muted` on `surface-3` scores
**4.03:1** against the 4.5:1 required for normal text, and `surface-3` is exactly the fill a job node
takes when hovered **and when selected** — so interacting with a node makes its text less readable.

**Why it matters.** PRODUCT.md commits to WCAG 2.1 AA without qualification and the surface brief
repeats it.

**Fix.** Lift `border-default` to clear 3:1 on `surface-1`; lift `text-muted` to clear 4.5:1 on
`surface-3`. Extend `test/tokens.test.ts` with a contrast assertion for every documented
foreground/background pair so the ramp cannot regress.

**Suggested command:** `/impeccable audit`, then `/impeccable polish` to re-tune the ramp.

### [P1] The graph has no keyboard equivalent and has invisible tab stops

**What.** `edgesFocusable` makes every dependency edge a tab stop whose focus outline lands on an SVG
`<g>` and renders as nothing. There is no arrow-key traversal and no roving tabindex. `onSelectJob(null)`
is reachable only from a mouse click, so no keyboard user can close the detail panel. Selection moves
no focus and fires no live region.

**Why it matters.** The surface brief is explicit: "The graph needs a keyboard-navigable,
screen-reader-legible equivalent, not only a visual one." It has neither — it has a tab order.

**Fix.** Drop `edgesFocusable` and move edge information into the focused node's description.
Implement roving-tabindex arrow navigation with Escape to deselect. Add a visible close control to
`JobDetailPanel`.

**Suggested command:** `/impeccable shape` for the graph's keyboard model, then `/impeccable audit`.

### [P2] The origin badge undersells itself and corrupts the identifier it displays

**What.** `uppercase` mangles case-sensitive template keys; the badge outweighs the value it
annotates; `ORIGIN_HINT` is only a `title`. Confirmed by the browser detector as a genuine
`text-overflow` of 28px despite `max-w-full truncate whitespace-nowrap`.

**Why it matters.** The brief names this the memorable moment and PRODUCT.md names origin a
first-rank commitment. The component meant to be the product's signature is the one place Keelson
rewrites user data on screen.

**Fix.** Two registers: a quiet always-on marker in **mono, not uppercase** (it is a string from the
file), plus a persistent non-tooltip explanation shown once per panel. Demote the badge's fill so the
value outweighs its annotation.

**Suggested command:** `/impeccable polish`.

## On the five known issues

Four of five are correctly scoped. Two are mis-prioritised:

- **"Eleven unused tokens"** mixes hygiene with a visible defect. `--radius-pill`, the two shadows
  and `text-on-accent` are genuinely dead and fine to drop. `--keelson-edge-width` and
  `--keelson-edge-width-strong` are not hygiene: their absence is why every edge on the primary
  surface renders in React Flow's stock grey, outside the design system. Split the item.
- **`EdgeData.highlighted` unconsumed** is logged as dead code. It is the selection feedback for the
  graph. Paired with the no-re-fit issue, the two together are the difference between "selection has
  no edge effect" and "selection has no visible effect at all" — which is what the screenshot shows.

## Persona Red Flags

**Alex (power user).** Cannot reach a job without a mouse or ~120 Tab presses — no arrow traversal,
and `edgesFocusable` interleaves invisible edge stops between node stops. No search, no filter, no
command palette; past ~15 jobs `fitView` with `minZoom={0.3}` zooms the graph below legibility and
there is no way to find anything. Double-submits constantly because `pending` renders nothing. Pays
352×790px — 24% of the viewport — for a stage-creation rail he uses rarely, while the graph he reads
constantly gets clipped. Every write makes the graph jump: `layoutPipeline` reruns on each change
while `fitView` is a mount-time prop.

**Sam (accessibility-dependent).** Cannot close the detail panel at all. Rewrites the YAML by arrowing
through the Stage dropdown — on Windows and Linux a closed native select fires `change` per keypress.
Tabs through stops she cannot see. **At 400% zoom on a 1280px laptop she gets 320 CSS px, and
`mobile.png` is exactly that failure**: two `shrink-0 w-[352px]` columns collapse `<main
className="min-w-0 flex-1">` to zero, the graph is not rendered at all, and the detail panel is
clipped at the viewport edge with no horizontal scroll to recover it. That is a WCAG 1.4.10 Reflow
failure, and it is a desktop failure, not a mobile footnote. Every control boundary is 1.3–1.6:1.
Selection is announced to no one. The origin badge's safety sentence never reaches her.

**Claire (security architect / RSSI, PRODUCT.md secondary audience).** Over half the chrome she sees
is editing controls she will never touch; nothing offers a read-only posture, so principle 5
("densité d'expert, lisibilité d'audit") is satisfied on the density half only. The view cannot tell
her what is *missing*, which is her job — honestly L3/L5 scope, but the current shape leaves no
surface where a coverage verdict could land. **And `include` is unresolved while the UI never says
so**: PRODUCT.md is explicit that a displayed pipeline may be partial and the UI must say so rather
than hide it, and no partial-pipeline indicator exists anywhere in `src`. Claire reads the graph as a
complete picture of the repo's security posture when it may be missing every job arriving via
`include:`. For an audit artefact that is the most dangerous omission in the product, because it is
silently wrong rather than visibly broken.

## Minor Observations

- `app.tsx` wraps `JobEditor` in `border-l` while `JobDetailPanel` draws its own `border-l` — two
  components own one edge.
- `store.ts` `send()` sets `error` then immediately calls `reload()`, which sets `error: null` on the
  409 path: the server's `OperationError` is discarded and only the generic stale notice survives,
  contradicting the brief's "operation rejected (server message shown verbatim)".
- `useHistoryShortcuts` guards INPUT/TEXTAREA/contentEditable, but CodeMirror's read-only
  `.cm-content` is a `div` with `contenteditable="false"`, so Ctrl+Z inside the opaque viewer fires a
  server operation.
- `OpaqueBlockView` creates an `EditorView` with no theme and no `syntaxHighlighting`, so
  `@codemirror/lang-yaml` buys nothing visible; it also has no `lineWrapping`, so a long `script:`
  line forces horizontal scrolling inside a 328px box.
- `layout.ts` silently invents a column for a job whose stage is undeclared, marked `implicit: false`
  — so a stage that exists only because a job references it is presented as declared, contradicting
  the `implicit` tag's own semantics.
- `ErrorBanner` and `NoticeBar` can mount simultaneously, pushing the header down and shifting the
  graph at exactly the moment the user is reading an error.
- The diagnostics strip is always mounted even at zero diagnostics; `max-h-1/3` is an upper bound with
  no lower bound, so its height changes on every edit that changes the diagnostic count.
- `DiagnosticsPanel` rows fire `selectByRange`, which may select a job scrolled out of the graph with
  nothing scrolling it into view.
- `graph.ts` builds edge `ariaLabel` strings reachable only via the invisible edge tab stops that P1
  recommends removing. Move that text into the node description.

## Questions to Consider

1. If the user judges every action by its `git diff`, why is the diff the one thing Keelson never
   shows them? `touched` is on the wire and thrown away.
2. Is the origin badge the memorable moment, or is the thing it points at? `.deploy-base` is a real
   object in the user's file with its own values, and the product draws it nowhere. A template as a
   ghost column upstream, with inheritance drawn as edges, would make origin structural rather than
   annotational — at the cost of one node type.
3. Why does the editing rail exist before the user has decided to edit? Two of three audiences barely
   edit. A read-first posture would fix four cognitive-load failures at once, return 352px to the
   graph, and give the RSSI a product.
4. The screenshot shows `lint` drawn inside the `build` column, with `layout.test.ts` and
   `graph.test.ts` both green. What else is the suite confirming is *computed* rather than confirming
   is *true*?
5. `EdgeData.highlighted` and `pending` are both modelled, unit-tested, and invisible. That suggests
   the test boundary is drawn at the store and never crosses into the render.
