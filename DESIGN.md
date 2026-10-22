---
name: Keelson
description: A dark, hairline-ruled pipeline workbench for designing a DevSecOps chain before implementing it.
colors:
  surface-0: "oklch(0.17 0.006 265)"
  surface-1: "oklch(0.21 0.007 265)"
  surface-2: "oklch(0.25 0.008 265)"
  surface-3: "oklch(0.29 0.009 265)"
  surface-inset: "oklch(0.14 0.006 265)"
  border-subtle: "oklch(0.29 0.008 265)"
  border-default: "oklch(0.56 0.01 265)"
  border-strong: "oklch(0.66 0.012 265)"
  text-primary: "oklch(0.96 0.003 265)"
  text-secondary: "oklch(0.78 0.006 265)"
  text-muted: "oklch(0.67 0.008 265)"
  accent: "oklch(0.68 0.16 258)"
  danger: "oklch(0.65 0.19 25)"
  danger-muted: "oklch(0.32 0.09 25)"
  warning: "oklch(0.78 0.14 75)"
  warning-muted: "oklch(0.34 0.07 75)"
  info: "oklch(0.72 0.09 230)"
  info-muted: "oklch(0.32 0.04 230)"
typography:
  lg:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "19px"
    lineHeight: "26px"
    fontWeight: 600
  base:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "15px"
    lineHeight: "22px"
    fontWeight: 400
  sm:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "13px"
    lineHeight: "20px"
    fontWeight: 400
  xs:
    fontFamily: "ui-monospace, \"SF Mono\", \"JetBrains Mono\", Menlo, Consolas, monospace"
    fontSize: "12px"
    lineHeight: "18px"
    fontWeight: 400
  2xs:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "11px"
    lineHeight: "16px"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  sm: "3px"
  md: "5px"
  lg: "8px"
spacing:
  base: "4px"
  0.5: "2px"
  1: "4px"
  1.5: "6px"
  2: "8px"
  2.5: "10px"
  3: "12px"
  4: "16px"
  6: "24px"
components:
  job-node:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
    typography: "{typography.base}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    width: "232px"
    height: "64px"
  job-node-hover:
    backgroundColor: "{colors.surface-3}"
  job-node-selected:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
  stage-column:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-primary}"
    typography: "{typography.sm}"
    rounded: "{rounded.lg}"
  stage-column-header:
    textColor: "{colors.text-primary}"
    typography: "{typography.sm}"
    padding: "0 10px"
    height: "32px"
  origin-badge:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.2xs}"
  field:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text-primary}"
    typography: "{typography.xs}"
    rounded: "{rounded.sm}"
    padding: "4px 6px"
    width: "100%"
  field-disabled:
    textColor: "{colors.text-muted}"
  button:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.xs}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  button-hover:
    backgroundColor: "{colors.surface-3}"
  button-disabled:
    textColor: "{colors.text-muted}"
  danger-button:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.xs}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  label:
    textColor: "{colors.text-muted}"
    typography: "{typography.2xs}"
  section-heading:
    textColor: "{colors.text-secondary}"
    typography: "{typography.sm}"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.2xs}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
  notice-chip:
    backgroundColor: "transparent"
    typography: "{typography.2xs}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
  confirm-dialog:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.xs}"
    rounded: "{rounded.md}"
    padding: "10px"
  opaque-block:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.xs}"
    rounded: "{rounded.sm}"
    padding: "4px"
  panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.sm}"
    padding: "12px"
    width: "352px"
  app-header:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text-primary}"
    typography: "{typography.sm}"
    padding: "0 12px"
    height: "44px"
---

# Design System: Keelson

## Overview

**Creative North Star: "The Instrument Panel"**

Keelson looks like the tool its reader already has open in the next window: a dark, dense,
hairline-ruled instrument panel for a CI pipeline. The whole product is one continuous dark field
(`surface-0`) onto which lighter planes are stacked a few percent of lightness at a time, divided by
one-pixel rules rather than by shadows or gaps. Nothing floats, nothing glows, nothing is
decorative. The reader's eye is meant to go to the pipeline, not to the chrome around it.

The world is the category standard played straight — stage columns, job cards, dependency edges,
interface sans-serif, dark by default — executed at the finish level of Linear, Vercel and Raycast
without borrowing their layout. Density is the aesthetic, but it is bounded: the ramp floors at 11px
and the greys that carry structure are pushed up until they clear WCAG 2.1 AA rather than left
where they looked quietest. The borders are deliberately brighter than a dark-theme instinct would
put them, because a border around a field is an interface component and owes 3:1, not a decoration.

Everything the product renders comes out of one file, `packages/ui/src/tokens.css`. There is no
colour, size, radius, spacing, duration or graph metric anywhere else, and a test fails if a
component hard-codes one — or if a token is declared and never consumed. The system is therefore
small on purpose: what is not in that file does not exist, and nothing in that file is dead.

**Key Characteristics:**

- Dark-only, five finely stepped surface planes in OKLCH at a near-neutral 265° hue.
- One-pixel borders everywhere; there is not a single shadow token and not a single `box-shadow`.
- A single cool-blue accent, reserved for the object being acted on and for focus.
- An 11 / 12 / 13 / 15 / 19px interface ramp, floored at 11px by test, on a 4px spacing base.
- Monospace for every string that came out of the user's YAML; sans-serif for everything Keelson
  wrote about it.
- Icons are inline SVG inheriting `currentColor` at `1em`; no text character is ever used as a mark.
- Every inherited value carries an origin badge naming where it came from.

## Colors

A near-neutral blue-grey field (hue 265°, chroma at or under 0.012) with one cool-blue accent and
three severity hues that appear only inside diagnostics, banners and the destructive path.

### Primary

- **Signal Blue** (`accent`): the only accent in the product and the only non-severity hue. It marks
  the selected job node's border, the dependency edges touching the selection, the global focus ring
  on `:focus-visible`, the field border under focus, the in-flight write indicator, and the property
  names in the read-only YAML viewer. It is never a fill behind text. It clears 3:1 against
  `surface-3`, tested, because a selected node is a hovered node.

### Secondary

The severity family. These are the only other hues, and each is paired with a word and a distinct
SVG mark, never used alone.

- **Alert Red** (`danger`) and **Alert Red Deep** (`danger-muted`): error diagnostics, the error
  banner (muted at 20% as a fill, solid as a border), the destructive button's text and border, and
  the unparseable-document container.
- **Caution Amber** (`warning`) and **Caution Amber Deep** (`warning-muted`): warning diagnostics,
  the stale-write notice bar, and the alert tone of the state container.
- **Notice Blue** (`info`) and **Notice Blue Deep** (`info-muted`): informational diagnostics and the
  reloaded notice bar. Held at 230° against the accent's 258° so an info row never reads as a
  selection.

### Neutral

- **Floor** (`surface-0`): the application background, the canvas behind the graph, and every
  full-bleed state screen.
- **Plane** (`surface-1`): every chrome panel — left sidebar, job detail panel, job editor,
  diagnostics strip, stage column body, state containers. One step up from the floor.
- **Card** (`surface-2`): the job node at rest, the delete-confirmation dialog, the
  content-unavailable notice, and the diagnostics row on hover.
- **Card Raised** (`surface-3`): the job node on hover *and* when selected, and the hover fill of
  every ghost button. Because it is both hover and selection, every text and border token that can
  land on it is contrast-tested against it.
- **Well** (`surface-inset`): below the floor. Only input fields, the read-only YAML viewer and the
  blocking-diagnostic rows use it; it is how the system says "verbatim or editable text goes here".
- **Rule Faint** (`border-subtle`): structural dividers only — header underline, panel edges,
  section separators, diagnostics row separators, stage column outline. Decorative under WCAG 1.4.11
  and deliberately exempt from the 3:1 floor.
- **Rule** (`border-default`): the border of every interface component — fields, selects, buttons,
  tags, the confirmation dialog, unselected job nodes. Lifted to L 0.56 so it clears 3:1 on
  `surface-0` through `surface-3`.
- **Rule Strong** (`border-strong`): the graph's connection handles and every dependency edge that
  is not highlighted.
- **Paper White** (`text-primary`): headings, job ids, diagnostic messages, field values.
- **Paper Dim** (`text-secondary`): body prose, button text, section headings, monospace values
  inside panels.
- **Paper Faint** (`text-muted`): the label voice, counts, the stage name under a job id, disabled
  text, and every "empty" sentence. At L 0.67 it clears 4.5:1 on all four surfaces.

### Named Rules

**The Attention Accent Rule.** The accent marks what is being acted on and nothing else: the
selection and its edges, the focused control, the write in flight, and the key side of YAML in the
viewer. It is never a fill behind text, never a button background, never a panel tint. There is no
`text-on-accent` token, and that absence is the enforcement.

**The Tested-Contrast Rule.** Every text-on-surface and component-border-on-surface pair the product
can produce is recomputed by `packages/ui/test/tokens.test.ts` and fails below 4.5:1 (text) or 3:1
(component boundary), with `surface-3` included because it is the hover *and* selected fill. A grey
is never darkened back down because it "looked quieter".

**The Never-Hue-Alone Rule.** A state is never carried by colour alone. Every severity ships with
the severity word spelled out and a distinct SVG silhouette — cross, triangle, disc — and every
notice bar carries a word chip ("Not applied", "Reloaded", "Deleted") that makes its colour
redundant.

**The Grey Default Rule.** A new surface starts entirely in the neutral ramp. A hue has to be earned
by selection, focus, a write in flight, or a diagnostic severity; "this feels important" is not a
justification.

## Typography

**Body Font:** the platform interface sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI",
Roboto, sans-serif`)
**Value/Mono Font:** the platform monospace (`ui-monospace, "SF Mono", "JetBrains Mono", Menlo,
Consolas, monospace`)

**Character:** there is no display face and no brand face. Keelson uses the reader's own system UI
font so the tool disappears into the desktop, and the system monospace for every string that came
out of the YAML file. The pairing is functional, not expressive: sans-serif means "Keelson is
telling you something", monospace means "this is your file".

### Hierarchy

Five steps across 11px to 19px. The floor is 11px and a test enforces it: below that, functional
text stops being legible at expert density. The steps were spread apart deliberately — a former
10/11/12/13 ramp gave a 1.3:1 range the eye could not read as a hierarchy. Three weights exist
(400, 500, 600); 500 is used once.

- **lg** (semibold, 19px/26px): the top of the ramp and the only heading size — the job detail
  panel's job id and every state-screen heading.
- **base** (regular 400, 15px/22px): the document default set on `body`, and the job node's job id
  at semibold. This is the largest type inside the graph.
- **sm** (regular, 13px/20px): the product name in the header, sidebar section headings (semibold),
  diagnostic messages, stage column names (semibold monospace), panel field values, and all prose in
  states and notices.
- **xs** (regular, 12px/18px): the working size for controls and file strings — every input and
  select, every button label, diagnostic codes, the open file path, opaque block keys, the
  confirmation question.
- **2xs** (semibold, 11px/16px, tracking 0.06em, uppercase): the label voice. Field labels, section
  labels inside the editor, tags, notice chips, severity words, counts, and the Keelson-side half of
  the origin badge (at weight 500).

### Named Rules

**The Eleven-Pixel Floor Rule.** No functional text is set below 11px. There is no step under
`--text-2xs`, and `packages/ui/test/tokens.test.ts` fails if one is added.

**The Monospace-Means-File Rule.** Monospace is reserved for text that exists in the user's YAML —
job ids as values, stage names, need targets, environment keys and values, diagnostic codes, file
paths, template names, opaque blocks — plus tabular counts, where it buys numeral alignment. Prose
Keelson wrote is set in the interface sans.

**The Small-Caps Label Rule.** A label naming a field, a section, a severity or a tag is 11px
semibold uppercase at 0.06em tracking. Uppercase appears nowhere else: not on a heading, not on a
sentence-shaped button, and never as a standalone line of copy above a title.

**The Two-Register Rule.** When Keelson's own wording and a string from the file sit in the same
element, they take different registers: Keelson's half goes small-caps sans, the file's half goes
monospace with `normal-case`. A case-sensitive YAML key is never rewritten on screen — `.deploy-base`
displayed as `.DEPLOY-BASE` is corrupted data, not styling.

**The Nineteen-Pixel Ceiling Rule.** The ramp stops at 19px and only headings use it. Hierarchy
below that comes from weight and colour, not from new sizes.

## Layout

The shell is a fixed full-height frame, never a scrolling page. Top to bottom: the notice and error
banners (each a single row at 12px horizontal, 6px vertical padding, present only when there is
something to say), a 44px header (`--keelson-header-height`) carrying the product name and the open
file path on the left and the write indicator plus the undo/redo pair on the right, then the working
row, then the diagnostics strip capped at one third of the viewport and scrolling internally.

The working row is three columns, each present only when it has content: a 352px left sidebar
(`--keelson-panel-width`) of titled control sections, the elastic graph canvas, and a 352px right
column holding the job detail panel above the job editor. Side columns scroll independently; the
canvas never scrolls, it pans and zooms (0.3× to 1.6×) and refits whenever its available width
changes, so opening the detail panel never pushes a column under it. Every column boundary is a
one-pixel `border-subtle` rule, not a gap.

There are no breakpoints. The layout is one desktop composition: below the point where the three
columns fit, the working row scrolls horizontally rather than reflowing, and the canvas is floored at
320px (`--keelson-canvas-min-width`) so two 352px panels can never crush the graph to zero — which is
also what keeps 400% zoom on a 1280px laptop legible (WCAG 1.4.10). The mobile capture shows exactly
this: the same frame, scrolled sideways.

Spacing is a strict 4px base (`--spacing`). The steps in use are 2, 4, 6, 8, 10, 12, 16 and 24px:
2–6px inside a control, 8–12px between controls and as panel padding, 16px between groups within a
panel and inside a state card, 24px as the only generous value in the system (the state-screen
gutter). Panel padding is always 12px; prose in a state card is capped at `max-w-prose`.

The graph's geometry is tokenised and read from CSS at runtime, so layout and style share one
source: job nodes are 232 × 64px, columns are separated by 72px, rows inside a column by 20px, the
column header is 32px tall, and a column carries 1px of padding below its last node. Those values
are handed to elkjs; changing the CSS changes the graph.

### Named Rules

**The Rule-Not-Gap Rule.** Regions are separated by a one-pixel border, never by whitespace alone and
never by a shadow. If two areas need distinguishing, draw the hairline.

**The Tokenised Geometry Rule.** Graph metrics live in `tokens.css` and are read through
`views/pipeline/metrics.ts`. No node size, column gap, row gap or header height is ever written in
TypeScript; a metric that fails to parse throws rather than falling back to a literal.

**The Conditional Column Rule.** Side columns are present or absent, never collapsed to a sliver. The
sidebar appears only when a pipeline is loaded and editable; the detail column appears only when a
job is selected, and closing it returns focus to the graph.

## Elevation & Depth

Keelson is flat, and flatness here is structural rather than stylistic: **there are no shadow tokens
and no `box-shadow` anywhere in the shipped UI.** Depth is entirely tonal. `surface-inset` reads as
below the floor, `surface-0` is the floor, and `surface-1` → `surface-2` → `surface-3` step upward
about four percent of lightness at a time. A one-pixel border does the rest of the work a shadow
would do. Even the destructive confirmation — the one place a design system usually reaches for an
overlay — is a `surface-2` block with a `border-default` hairline, inline in the editor's flow.

The only non-tonal depth cue is stacking inside the graph, where stage columns sit at z-index 0 and
job nodes at z-index 1 so a card reads as lying on its column.

### Named Rules

**The No-Shadow Rule.** The system has no elevation vocabulary to reach for. Depth is a surface step
plus a hairline; if a new surface seems to need lifting, it needs the next `surface-*` token, not a
shadow token invented for it.

**The Inline-Modal Rule.** A dialog is a bordered block in the flow that owns focus, not a floating
plane. It carries `role="alertdialog"` and `aria-modal`, focus moves into it on open, Escape cancels
it without disturbing the panel behind it, and focus returns to the control that opened it.

## Shapes

Everything is a rectangle with a small, considered radius, and the scale is semantic rather than
decorative: 3px (`rounded.sm`) for small controls — inputs, buttons, tags, notice chips, severity
marks, the YAML viewer; 5px (`rounded.md`) for the job node and the confirmation dialog, the two
objects that read as discrete things rather than controls; 8px (`rounded.lg`) for the two large
containers, the stage column and the state card. Banners, headers, panels and the diagnostics strip
have no radius at all: they are full-bleed bands bounded by their hairline.

Every border is one pixel, including the one Tailwind draws for the bare `border` class, which reads
`--default-border-width` from the token file rather than the framework default. There is no 2px
border; the only 2px stroke is the focus ring, at 2px offset. Dependency edges are curves between
left/right handles and are the one place stroke weight carries meaning: 1.5px
(`--keelson-edge-width`) in `border-strong` normally, 2.5px (`--keelson-edge-width-strong`) in
`accent` when the edge touches the selection, dashed at 4px when the dependency is optional.

Icons are inline SVG on a 16-unit viewBox, 1.75 stroke, sized `1em` and coloured `currentColor`, so
a mark always matches the size and colour of the text beside it. Severity marks are distinguished by
silhouette — cross, triangle, disc — not by an interior detail that vanishes at 11px.

### Named Rules

**The Three-Radius Rule.** 3px for controls, 5px for nodes and dialogs, 8px for containers.
Full-bleed bands get none. A fourth radius has to displace one of these, not join them.

**The One-Pixel Rule.** Borders are one pixel. Weight is expressed by moving along the
`border-subtle` → `border-default` → `border-strong` ramp, never by thickening the line. The
dependency edge is the single exception, and it is in-system: both its weights are tokens.

**The Drawn-Mark Rule.** Every mark is drawn as SVG. A text character is never used as an icon:
`✕ ! i ↳ ← →` rendered at the mercy of the reader's font stack, and the system does not accept a
glyph whose shape it cannot guarantee.

## Components

### Buttons

Ghost by default. There is no filled button anywhere in the product.

- **Shape:** tightly rounded corners (3px), one-pixel `border-default`.
- **Default:** transparent fill, `text-secondary` label at 12px, padding 4px 8px.
- **Hover / Focus:** fill fades to `surface-3` over 140ms on `--ease-out`; focus draws the global 2px
  accent ring at 2px offset.
- **Disabled:** label drops to `text-muted`, cursor becomes `not-allowed`, and the hover fill is
  suppressed so the control cannot look responsive.
- **Danger:** same ghost geometry with a `danger-muted` border and `danger` label; hover fills with
  `danger-muted` at 30%. Used only for destroying something (Delete job, and the confirmation's own
  confirm button).
- **Icon button:** the stage reorder pair is the same button with an SVG arrow in place of the label
  and an `aria-label`; it never shrinks below the standard padding.

### Chips

Two kinds, both built from the label voice (11px uppercase, 0.06em tracking, 3px radius, one-pixel
border, 4px horizontal padding, transparent fill).

- **Tag:** `border-default` outline, `text-muted` text. Marks a qualifier on a value — `optional`,
  `no artifacts`, `read-only`, `implicit`.
- **Notice chip:** `border-current`, so it inherits the banner's severity colour, semibold. Carries
  the word that makes the banner's colour redundant.

### Cards / Containers

- **Job node:** 232 × 64px, 5px radius, `surface-2` fill, one-pixel border that is `border-default`
  at rest and `accent` when selected; `surface-3` fill on hover and when selected. Padding 8px 10px.
  Two lines: the job id at 15px semibold `text-primary`, then the stage name in 12px monospace
  `text-muted` followed by its origin badge. It is a `button` with `aria-pressed` and an off-screen
  description naming its stage, dependencies, environment and templates.
- **Stage column:** 8px radius, `surface-1` fill, `border-subtle` outline, with a 32px header
  underlined by another hairline. The header carries the stage name (13px semibold monospace), an
  `implicit` tag when the stage is not declared in the file, and a right-aligned tabular job count.
  It is a `role="group"` with an accessible name, never a landmark.
- **Panel:** `surface-1`, no radius, 12px padding, bounded by a hairline on the edge facing the
  canvas, 16px between its sections.
- **Titled sidebar section:** a `role="group"` labelled by a 13px semibold `text-secondary` heading
  (`SECTION_HEADING`), 8px to its content, separated from the next section by a `border-subtle` rule
  and 16px of padding — suppressed on the last one. The section heading is deliberately a different
  voice from the 11px label that names a field: a section and a field cannot speak in the same voice
  or there is no hierarchy left.
- **State card:** 8px radius, `surface-1` on the bare floor, 16px padding, prose capped at
  `max-w-prose`, heading at 19px semibold. The alert tone swaps the `border-subtle` outline for
  `warning-muted` (or `danger-muted` for an unparseable document) and adds `role="alert"`.

### Inputs / Fields

- **Style:** full-width, 3px radius, one-pixel `border-default`, `surface-inset` fill, 12px monospace
  `text-primary`, padding 4px 6px. Inputs, textareas and selects share one class, so a dropdown and a
  text field are indistinguishable in weight.
- **Focus:** the border becomes `accent` over 140ms, under the global 2px accent focus ring.
- **Disabled:** text drops to `text-muted` with a `not-allowed` cursor; the recessed fill stays, so a
  disabled field still reads as a field. Every control in the editor is disabled while a write is in
  flight.
- **Label:** always the 11px uppercase label voice above the control, in a 6px-gap vertical group.

### Navigation

Keelson has no navigation in the site sense. The 44px header is an identity-and-state bar: the
product name at 13px semibold, the open file path beside it in 12px monospace `text-muted`
truncating from the end, and on the right the write indicator and the undo/redo ghost pair with
their shortcuts in the `title` attribute. It is underlined by a hairline and sits on the floor
colour.

### Diagnostics Strip

A `surface-1` band along the bottom, capped at one third of the viewport, separated from the working
row by a hairline. Its header pairs the 11px uppercase word "Diagnostics" with a tabular count. Rows
are separated by hairlines (the last suppressed), sorted error → warning → info, and each row reads
in three parts: a 16px square severity mark in a 3px-radius box tinted by the severity's `*-muted`
border and `*` text colour, the severity word in the label voice, then the diagnostic code in 12px
monospace `text-secondary` above the message in 13px `text-primary`. A row with a source range is a
button and fills `surface-2` on hover; a row without one is a plain div that does not pretend to be
clickable.

### Pending Indicator

While a write is in flight, the header shows a `role="status"` group: a 6px accent square at the
small 3px radius, then the word "Writing" in the label voice — 11px semibold uppercase at 0.06em
tracking in the interface sans, like every other thing Keelson says about the file rather than out
of it. It is the only moving part of the system in the sense that it appears and disappears; it does
not animate, and every control it affects is simultaneously disabled.

### Read-Only YAML Viewer

Opaque blocks — the parts of the file Keelson preserves but does not model — render in a CodeMirror
instance that is fully themed from the palette: the container owns the font, size, `surface-inset`
fill, 3px radius and `border-subtle` outline, and the editor theme neutralises everything CodeMirror
would otherwise impose. Its highlight style maps every tag to a token: keys in `accent`, keywords in
`text-primary`, strings, numbers and booleans in `text-secondary`, comments and meta in `text-muted`
and italic. Lines wrap, gutters are hidden, and the view is read-only with no focus outline of its
own. When the range cannot be read back from the file, the block is replaced by an explicit
"Content unavailable" notice on `surface-2` stating that the block is still on disk and untouched.

### The Origin Badge (signature component)

The product's signature. Any value a job inherited rather than declared carries a badge immediately
after it: an inline SVG inheritance mark, then Keelson's own wording in the 11px small-caps label
voice at weight 500 in `text-muted` ("inherited from", "from anchor", "from reference", "default"),
then — where there is one — the source string from the file in monospace `normal-case`
`text-secondary`. It truncates rather than wrapping, and its `title` states that editing the value
writes an explicit override in this job and never touches the template.

The badge carries no fill, no border and no radius: it is pure type, because it appears many times
per screen and must not accumulate into visual noise. It renders on the job node beside the stage
name and in the detail panel beside each field label, and the two instances are the same component
at the same size.

## Do's and Don'ts

### Do:

- **Do** take every colour, size, radius, duration and graph metric from `packages/ui/src/tokens.css`.
  Tests fail both on a hard-coded value in a component and on a token declared without a consumer.
- **Do** keep the accent on the object being acted on and on focus (The Attention Accent Rule).
- **Do** re-run the contrast test when touching a grey: every documented pair is recomputed against
  `surface-0` through `surface-3`, and `surface-3` is included because it is the selected-and-hovered
  node fill (The Tested-Contrast Rule).
- **Do** separate regions with a one-pixel border from the `border-subtle` → `border-default` →
  `border-strong` ramp (The Rule-Not-Gap Rule, The One-Pixel Rule).
- **Do** express depth by stepping a surface token (The No-Shadow Rule).
- **Do** set every value that came out of the user's YAML in monospace, and everything Keelson wrote
  in the interface sans (The Monospace-Means-File Rule).
- **Do** keep Keelson's wording and the file's wording in different registers inside the same element,
  and leave file strings in their original case (The Two-Register Rule).
- **Do** draw every mark as inline SVG that inherits `currentColor` and sizes in `em` (The Drawn-Mark
  Rule).
- **Do** pair every severity colour with the severity word and a distinct silhouette (The
  Never-Hue-Alone Rule).
- **Do** give a destructive action a confirmation that owns focus: `role="alertdialog"`,
  `aria-modal`, focus into the confirm button, Escape cancels without closing the panel behind it,
  focus back to the trigger (The Inline-Modal Rule).
- **Do** announce an in-flight write with `role="status"` and disable the controls it affects.
- **Do** give an unreadable or missing region an explicit, worded state rather than an empty box.
- **Do** animate only colour, only on hover and focus, only through `var(--duration-fast)` with
  `--ease-out`, so the reduced-motion collapse at the token layer keeps working without `!important`.
- **Do** give a container-like grouping `role="group"` with an `aria-label` rather than a `<section>`,
  so stage columns, opaque blocks and sidebar sections stay out of the landmark list.

### Don't:

- **Don't** render a `box-shadow`, and don't introduce a shadow or elevation token. The system has no
  elevation vocabulary and the flatness is load-bearing.
- **Don't** put text on the accent or fill a button, panel or banner with it. There is no
  `text-on-accent` token to make that legible.
- **Don't** set functional text below 11px, and don't add a size between the existing steps or above
  19px (The Eleven-Pixel Floor Rule, The Nineteen-Pixel Ceiling Rule).
- **Don't** darken `border-default`, `border-strong` or `text-muted` back toward a quieter dark-theme
  grey; those three values are where they are because the contrast test put them there.
- **Don't** use `border-subtle` on `surface-3`: it is the same lightness as that plane and will
  disappear. It is a divider for `surface-0`/`surface-1`, and it is exempt from 3:1 precisely because
  it is never a component boundary.
- **Don't** use uppercase outside the 11px label voice — no uppercase headings, no uppercase sentence
  buttons, and no uppercase standalone line of copy above a title (The Small-Caps Label Rule).
- **Don't** upper-case, truncate-in-the-middle or otherwise restyle a string that came from the user's
  file. It is data on screen.
- **Don't** use a text character as an icon (The Drawn-Mark Rule).
- **Don't** add a radius outside 3 / 5 / 8px, and don't give a full-bleed band a radius at all.
- **Don't** thicken a border to signal importance; move along the border ramp instead. The only 2px
  stroke is the focus ring, and the only weighted stroke is the dependency edge, whose two weights
  are tokens.
- **Don't** introduce a light theme or a second accent hue; `color-scheme: dark` is a commitment and
  the severity hues are the only other colours.
- **Don't** write a node size, column gap or row gap in TypeScript; it belongs in `tokens.css` and is
  read at runtime (The Tokenised Geometry Rule).
- **Don't** add breakpoint-specific styling to make the shell reflow on a narrow viewport. The frame
  scrolls horizontally by design and the canvas is floored at 320px; a reflow would be a new layout
  decision, not a fix.
- **Don't** smuggle in the rejected worlds: no revision bars or specification-sheet margins, no
  wiring-schematic ornament, no high-density Japanese grid, no transit-diagram line styling.
