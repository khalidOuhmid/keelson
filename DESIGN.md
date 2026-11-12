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
  layer-build: "oklch(0.8 0.1 165)"
  layer-test: "oklch(0.8 0.1 310)"
  layer-operate: "oklch(0.82 0.1 115)"
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
  job-node-included:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-primary}"
    typography: "{typography.base}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    width: "232px"
    height: "64px"
  job-node-included-selected:
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
  layer-tag-build:
    backgroundColor: "transparent"
    textColor: "{colors.layer-build}"
    typography: "{typography.2xs}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
  layer-tag-test:
    backgroundColor: "transparent"
    textColor: "{colors.layer-test}"
    typography: "{typography.2xs}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
  layer-tag-operate:
    backgroundColor: "transparent"
    textColor: "{colors.layer-operate}"
    typography: "{typography.2xs}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
  layer-tag-platform:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
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
  view-button-current:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
    typography: "{typography.xs}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  partial-pipeline-bar:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.sm}"
    padding: "6px 12px"
  coverage-row:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.sm}"
    rounded: "{rounded.sm}"
    padding: "4px"
  coverage-row-hover:
    backgroundColor: "{colors.surface-3}"
  catalog-row:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    typography: "{typography.sm}"
    rounded: "{rounded.sm}"
    padding: "4px"
  catalog-row-hover:
    backgroundColor: "{colors.surface-2}"
  catalog-row-selected:
    backgroundColor: "{colors.surface-3}"
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
- Three layer-family hues, only on layer tags and always beside the word that names the layer.
- One breakpoint, `lg`, below which three panels become full-screen overlays (ADR 0008).
- An origin badge names where an inherited value came from, in the detail panel and on an editable
  job node of the Pipeline view; an included node and the coverage overlay carry none.

## Colors

A near-neutral blue-grey field (hue 265°, chroma at or under 0.012) with one cool-blue accent, three
severity hues that appear only inside diagnostics, banners and the destructive path, and three
layer-family hues that appear only on layer tags.

### Primary

- **Signal Blue** (`accent`): the only accent in the product. It marks the selected job node's
  border, the dependency edges touching the selection, the outline of the job nodes in the chosen
  layer on the coverage overlay, the current view's button border, the pressed row of the
  covered-layers list, the global focus ring on `:focus-visible`, the field border under focus, the
  in-flight write indicator, the property names in the read-only YAML viewer, and the text of the
  "See tools" and "Homepage" links. It is never a fill behind text. It clears 3:1 against
  `surface-3`, tested, because a selected node is a hovered node.

### Secondary

The severity family. Each hue is paired with a word and a distinct SVG mark, never used alone.

- **Alert Red** (`danger`) and **Alert Red Deep** (`danger-muted`): error diagnostics, the error
  banner (muted at 20% as a fill, solid as a border), the destructive button's text and border, and
  the unparseable-document container.
- **Caution Amber** (`warning`) and **Caution Amber Deep** (`warning-muted`): warning diagnostics,
  the stale-write notice bar, and the alert tone of the state container.
- **Notice Blue** (`info`) and **Notice Blue Deep** (`info-muted`): informational diagnostics and the
  reloaded notice bar. Held at 230° against the accent's 258° so an info row never reads as a
  selection.

### Tertiary

The layer families. With the accent and the severities these are the only hues in the product, and
they appear only on layer tags, as border and text. Each colours the family of a layer; the word on
the tag names the layer. Each clears 4.5:1 on `surface-3`, tested.

- **Verdigris** (`layer-build`): the build family.
- **Orchid** (`layer-test`): the test family.
- **Lichen** (`layer-operate`): the operate family.

The fourth family, `platform`, has no hue: its tags take `border-default` and `text-secondary`.

### Neutral

- **Floor** (`surface-0`): the application background, the canvas behind the graph, and every
  full-bleed state screen.
- **Plane** (`surface-1`): every chrome panel — left sidebar, job detail panel, job editor, tool
  panel, diagnostics strip, partial pipeline bar, stage column body, state containers — and the
  fill of an included job node at rest. One step up from the floor.
- **Card** (`surface-2`): the editable job node at rest, the delete-confirmation dialog, the
  content-unavailable notice, and the diagnostics row and catalogue row on hover.
- **Card Raised** (`surface-3`): an editable job node on hover, any job node when selected, the
  current view's button, the pressed catalogue row, and the hover fill of every ghost button and
  covered-layer row. Because it is both hover and selection, every text and border token that can
  land on it is contrast-tested against it.
- **Well** (`surface-inset`): below the floor. Only input fields, the read-only YAML viewer and the
  blocking-diagnostic rows use it; it is how the system says "verbatim or editable text goes here".
- **Rule Faint** (`border-subtle`): structural dividers only — header underline, panel edges,
  section separators, diagnostics row separators, the partial pipeline bar's underline, catalogue
  table rows, stage column outline. Decorative under WCAG 1.4.11 and deliberately exempt from the
  3:1 floor. It closes a shape in one place only, the stage column, a backdrop behind its job nodes
  and not a component; everywhere else it is a rule on one named edge, and
  `packages/ui/test/tokens.test.ts` fails on any other closed shape.
- **Rule** (`border-default`): the border of every interface component — fields, selects, buttons,
  tags, the confirmation dialog, the state card, the YAML viewer, unselected job nodes, included
  ones too. Lifted to L 0.56 so it clears 3:1 on `surface-0` through `surface-3`.
- **Rule Strong** (`border-strong`): the graph's connection handles and every dependency edge that
  is not highlighted.
- **Paper White** (`text-primary`): headings, job ids, diagnostic messages, field values.
- **Paper Dim** (`text-secondary`): body prose, button text, section headings, monospace values
  inside panels.
- **Paper Faint** (`text-muted`): the label voice, counts, the stage name under a job id, disabled
  text, and every "empty" sentence. At L 0.67 it clears 4.5:1 on all four surfaces.

### Named Rules

**The Attention Accent Rule.** The accent marks what is being acted on and nothing else: the
selection and its edges, the chosen layer and its nodes, the current view, the focused control, the
write in flight, a panel's primary link, and the key side of YAML in the viewer. It is never a fill
behind text, never a button background, never a panel tint. There is no `text-on-accent` token, and
that absence is the enforcement.

**The Tested-Contrast Rule.** Every text-on-surface and component-border-on-surface pair the product
can produce is recomputed by `packages/ui/test/tokens.test.ts` and fails below 4.5:1 (text) or 3:1
(component boundary), with `surface-3` included because it is the hover *and* selected fill. A grey
is never darkened back down because it "looked quieter". The layer hues are held to the 4.5:1 text
threshold on `surface-3`, because a layer tag's text sits on a selected node.

**The Never-Hue-Alone Rule.** A state is never carried by colour alone. Every severity ships with
the severity word spelled out and a distinct SVG silhouette — cross, triangle, disc — and every
notice bar carries a word chip ("Not applied", "Reloaded", "Deleted") that makes its colour
redundant.

**The Family-Colour Rule.** Colour groups a layer's family; the word names the layer. A layer is
never read from its hue: every layer tag spells the layer's short name and carries its full name in
`title`, and the `platform` family takes no hue at all.

**The Grey Default Rule.** A new surface starts entirely in the neutral ramp. A hue has to be earned
by selection, focus, a write in flight, a diagnostic severity, or a layer family on a layer tag;
"this feels important" is not a justification.

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
  panel's job id, the tool panel's tool name and every state-screen heading.
- **base** (regular 400, 15px/22px): the document default set on `body`, and the job node's job id
  at semibold. This is the largest type inside the graph.
- **sm** (regular, 13px/20px): the product name in the header, sidebar section headings (semibold),
  diagnostic messages, stage column names (semibold monospace), panel field values, and all prose in
  states and notices.
- **xs** (regular, 12px/18px): the working size for controls and file strings — every input and
  select, every button label, diagnostic codes, the open file path, opaque block keys, the
  confirmation question.
- **2xs** (semibold, 11px/16px, tracking 0.06em, uppercase): the label voice. Field labels, section
  labels inside the editor, catalogue column headings, tags, layer tags, notice chips, severity
  words, counts, and the Keelson-side half of the origin badge (at weight 500).

### Named Rules

**The Eleven-Pixel Floor Rule.** No functional text is set below 11px. There is no step under
`--text-2xs`, and `packages/ui/test/tokens.test.ts` fails if one is added.

**The Monospace-Means-File Rule.** Monospace is reserved for text that exists in the user's YAML —
job ids as values, stage names, need targets, environment keys and values, diagnostic codes, file
paths, template names, opaque blocks — plus tabular counts, where it buys numeral alignment, and
licence identifiers in the catalogue. Prose Keelson wrote is set in the interface sans.

**The Small-Caps Label Rule.** A label naming a field, a section, a table column, a severity or a
tag is 11px semibold uppercase at 0.06em tracking. Uppercase appears nowhere else: not on a heading, not on a
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
something to say), a header of at least 44px (`--keelson-header-height`) that wraps its controls,
carrying the product name and the open file path on the left and the write indicator, the view
switcher and the undo/redo pair on the right, then the partial pipeline bar when includes are
unresolved, then the working row, then the diagnostics strip. The bar and the strip are each capped
at one third of the viewport and scroll internally.

The working row is three columns, each present only when it has content: a 352px left sidebar
(`--keelson-panel-width`) of titled control sections on the Pipeline view and of the coverage panel
on the Coverage view, the elastic graph canvas, and a 352px right column holding the job detail
panel. The job editor renders under that panel on the Pipeline view only, and never for a job from
an included file. The Catalog view has neither side column: its main area holds the filter form,
the tool table and, when a tool is selected, a 352px tool panel. Side columns scroll independently;
the canvas never scrolls, it pans and zooms (0.3× to 1.6×) and refits whenever its available width
changes, so opening the detail panel never pushes a column under it. Every column boundary is a
one-pixel `border-subtle` rule, not a gap.

There is one breakpoint, `lg`: Tailwind's default 64rem (1024px), which `tokens.css` does not
redeclare. From `lg` up the layout is one desktop composition, and the canvas is floored at 320px
(`--keelson-canvas-min-width`) so two 352px panels can never crush the graph to zero. Below `lg`, and
only there (ADR 0008), the job detail panel, the left sidebar and the tool panel leave the row and
become full-screen overlays; the sidebar opens from a `Panel` button in the header and closes from
its own `Close panel` button or Escape, and the graph keeps the viewport. An overlay covers the
screen, so it owns focus: opening it moves focus to its first control, Tab cycles inside it, and
closing it returns focus to the control that opened it (The Covering-Surface Rule).
The breakpoint changes where these three panels sit, never their content, and the desktop
composition does not change.

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
sidebar appears only when a pipeline is loaded and no diagnostic blocks it; the detail column appears
only when a job is selected, and closing it returns focus to the graph. Neither appears on the
Catalog view, and below `lg` the sidebar stays closed until the `Panel` button opens it.

**The One-Breakpoint Rule.** `lg` is the product's only breakpoint, and ADR 0008 is its only licence:
below it the job detail panel, the left sidebar and the tool panel become full-screen overlays. It
moves those three panels and touches nothing else.

## Elevation & Depth

Keelson is flat, and flatness here is structural rather than stylistic: **there are no shadow tokens
and no `box-shadow` anywhere in the shipped UI.** Depth is entirely tonal. `surface-inset` reads as
below the floor, `surface-0` is the floor, and `surface-1` → `surface-2` → `surface-3` step upward
about four percent of lightness at a time. A one-pixel border does the rest of the work a shadow
would do. Even the destructive confirmation — the one place a design system usually reaches for an
overlay — is a `surface-2` block with a `border-default` hairline, inline in the editor's flow.

The only non-tonal depth cue is stacking inside the graph, where stage columns sit at z-index 0 and
job nodes at z-index 1 so a card reads as lying on its column. The full-screen overlays below `lg`
sit at z-index 20, and they replace the frame rather than lift above it: a `surface-1` plane edge to
edge, with no shadow.

### Named Rules

**The No-Shadow Rule.** The system has no elevation vocabulary to reach for. Depth is a surface step
plus a hairline; if a new surface seems to need lifting, it needs the next `surface-*` token, not a
shadow token invented for it.

**The Covering-Surface Rule.** Whatever covers the rest of the screen owns focus, and only that: the
confirmation dialog and, below `lg`, the three overlays. Opening one moves focus
into it, Tab and Shift+Tab cycle inside it, Escape closes it, and closing it — by button or by
Escape — returns focus to the control that opened it, or to the graph when that control is gone.
Only a surface that blocks the page carries `aria-modal`. From `lg` up a side column covers nothing
and leaves focus where it is. The policy lives in `src/focus.ts`.

**The Inline-Modal Rule.** A dialog is a bordered block in the flow that owns focus, not a floating
plane. It carries `role="alertdialog"` and `aria-modal`, focus moves into it on open, Escape cancels
it without disturbing the panel behind it, and focus returns to the control that opened it.

## Shapes

Everything is a rectangle with a small, considered radius, and the scale is semantic rather than
decorative: 3px (`rounded.sm`) for small controls — inputs, buttons, tags, layer tags, notice chips,
severity marks, the YAML viewer, coverage and catalogue rows; 5px (`rounded.md`) for the job node and
the confirmation dialog, the two objects that read as discrete things rather than controls; 8px (`rounded.lg`) for the two large
containers, the stage column and the state card. Banners, headers, panels and the diagnostics strip
have no radius at all: they are full-bleed bands bounded by their hairline.

Every border is one pixel, including the one Tailwind draws for the bare `border` class, which reads
`--default-border-width` from the token file rather than the framework default. There is no 2px
border. The two 2px strokes are outlines in `accent`: the focus ring at 2px offset, and the emphasis
on the job nodes of the chosen layer on the coverage overlay (`--keelson-emphasis-width`), with no offset, drawn outside the node's
one-pixel border, which keeps its own colour. Dependency edges are curves between
left/right handles and are the one place stroke weight carries meaning: 1.5px
(`--keelson-edge-width`) in `border-strong` normally, 2.5px (`--keelson-edge-width-strong`) in
`accent` when the edge touches the selection, dashed at 4px when the dependency is optional or, on the
Toolchain view, when the integration is only proposed. A toolchain edge also carries its type in
words and an arrowhead, so neither dash nor colour speaks alone.

Icons are inline SVG on a 16-unit viewBox, 1.75 stroke, sized `1em` and coloured `currentColor`, so
a mark always matches the size and colour of the text beside it. Severity marks are distinguished by
silhouette — cross, triangle, disc — not by an interior detail that vanishes at 11px. Tool logos
are the one drawn exception: a filled path on a 24-unit viewBox, still `1em` and `currentColor`, so no
brand colour enters the palette. A tool without a logo takes a neutral stroked square.

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
- **Target size:** every button, every standalone text link and every checkbox row is at least
  24 × 24px (`min-h-6 min-w-6`), the WCAG 2.2 target-size floor, even though the commitment in
  `PRODUCT.md` is 2.1 AA. A checkbox keeps its native size; its whole label row is the target.
- **Current view:** the view switcher's button for the open view carries `aria-current="page"`, an
  `accent` border, the `surface-3` fill and a semibold `text-primary` label.
- **Text link:** no border and no fill, underlined at a 2px offset. `accent` for "See tools" and
  "Homepage", `text-secondary` for the "OWASP guideline" and verification-date links.

### Chips

Three kinds, all built from the label voice (11px uppercase, 0.06em tracking, 3px radius, one-pixel
border, 4px horizontal padding, transparent fill).

- **Tag:** `border-default` outline, `text-muted` text. Marks a qualifier on a value — `optional`,
  `no artifacts`, `read-only`, `implicit`, the count of included files, the form of an unresolved
  include.
- **Layer tag:** border and text in the family's hue, or `border-default` and `text-secondary` for
  the `platform` family, at regular weight. It spells the layer's short name, carries the full name
  in `title`, and truncates. A job node or a catalogue row shows at most two, followed by a `+N`
  count in 11px monospace `text-muted`, and on a node the chosen layer sorts first so the limit
  cannot hide it. The coverage panel, the detail panel and the tool panel show every layer.
- **Notice chip:** `border-current`, so it inherits the banner's severity colour, semibold. Carries
  the word that makes the banner's colour redundant.

### Cards / Containers

- **Job node:** 232 × 64px, 5px radius, `surface-2` fill, one-pixel border that is `border-default`
  at rest and `accent` when selected; `surface-3` fill on hover and when selected. Padding 8px 10px.
  Two lines: the job id at 15px semibold `text-primary`, then the stage name in 12px monospace
  `text-muted` followed by its origin badge. On the coverage overlay layer tags replace that second
  line, and the nodes of the chosen layer take the 2px `accent` outline. It is a `button` with
  `aria-pressed` and an off-screen description naming its stage, dependencies, environment and
  templates, plus its layers on the overlay.
- **Included job node:** the same geometry and the same button for a job from an included file, one
  plane down: `surface-1` fill at rest, no hover response, `border-default` border, a `read-only` tag
  beside the job id, no origin badge, and an off-screen description that opens by naming the file.
  Selection still applies, with the `accent` border and the `surface-3` fill.
- **Stage column:** 8px radius, `surface-1` fill, `border-subtle` outline, with a 32px header
  underlined by another hairline. The header carries the stage name (13px semibold monospace), an
  `implicit` tag when the stage is not declared in the file, and a right-aligned tabular job count.
  It is a `role="group"` with an accessible name, never a landmark.
- **Panel:** `surface-1`, no radius, 12px padding, bounded by a hairline on the edge facing the
  canvas, 16px between its sections. For an included job the detail panel adds the `read-only` tag
  beside the job id, a sentence saying why it cannot be edited here, and a Source file field, and
  `JobEditor` is not rendered.
- **Titled sidebar section:** a `role="group"` labelled by a 13px semibold `text-secondary` heading
  (`SECTION_HEADING`), 8px to its content, separated from the next section by a `border-subtle` rule
  and 16px of padding — suppressed on the last one. The section heading is deliberately a different
  voice from the 11px label that names a field: a section and a field cannot speak in the same voice
  or there is no hierarchy left.
- **State card:** 8px radius, `surface-1` on the bare floor, 16px padding, prose capped at
  `max-w-prose`, heading at 19px semibold. The alert tone swaps the `border-default` outline for
  `warning-muted` (or `danger-muted` for an unparseable document) and adds `role="alert"`.

**The One-Stop Graph Rule.** The pipeline graph is a single tab stop (roving tabindex): the selected
job, else the last focused one, else the first. Up and Down move within a stage, Left and Right
cross to the nearest job of the neighbouring stage, Shift+Left and Shift+Right follow a dependency to
a job it needs or a job that needs it, Home and End reach the ends, Enter opens the job. A job
reached off-screen is panned into view at the current zoom. Edges are never tab stops. Every node
points to the instructions through `aria-describedby`, after its own description.

**The Read-Only Object Rule.** A job Keelson will never write stays an object. It steps down one
plane and loses its hover, but it keeps its `border-default` boundary, says `read-only` in words,
and gets no editor.

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

The header is an identity-and-state bar of at least 44px holding the product's one navigation group:
the product name at 13px semibold, the open file path beside it in 12px monospace `text-muted`
truncating from the end, a tag counting the included files when there are any, and on the right the
write indicator, the `Panel` button below `lg`, on the Pipeline and Coverage views the `Find job`
ghost button (Ctrl+K, Cmd+K or `/` outside a field), the `Views` navigation of four ghost buttons
(Pipeline, Toolchain, Coverage, Catalog), and on the Pipeline and Toolchain views the undo/redo ghost pair with their shortcuts
in the `title` attribute. It is underlined by a hairline and sits on the floor colour.

### Provider

On a GitHub workflow, stage columns read `level N`, derived from `needs`, and every control that would
write a stage or a need option is absent rather than disabled: nothing in the file could hold it. When
a repository has several pipeline files the header path becomes a compact select named `Pipeline file`,
grouped by provider, no wider than a panel, and the coverage panel says which file it speaks of. The
partial pipeline bar counts reusable workflows there instead of includes.

### Diff

The insertion form shows what will be written before anything is. A monospace block on
`surface-inset`, lines wrapped so nothing about to be written sits out of sight. An added line is an
`ins` on `surface-2` in `text-primary`, a removed line a `del` on the danger tint in `danger`, each
with its sign and, for a screen reader, its word; two unchanged lines stay around each change and an
ellipsis stands for the rest. Sign and word carry the meaning, the fill only repeats it. `Insert into
<file>` is the one button there with a `border-strong` edge and `text-primary` label, which is how a
primary action reads in a system that has no filled button.

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
would otherwise impose. The tool panel's CI snippets render in the same viewer. Its highlight style
maps every tag to a token: keys in `accent`, keywords in
`text-primary`, strings, numbers and booleans in `text-secondary`, comments and meta in `text-muted`
and italic. Lines wrap with a hanging indent — a continuation starts two columns past its own line's
indentation, so it never reads as a new key — gutters are hidden, and the view is read-only with no focus outline of its
own. When the range cannot be read back from the file, the block is replaced by an explicit
"Content unavailable" notice on `surface-2` stating that the block is still on disk and untouched.

### Job Table

The graph's text equivalent, chosen from a `Display` pair of ghost toggle buttons (`Graph`, `Table`,
the pressed one styled like the current view) in a hairline-ruled row above the canvas on the
Pipeline and Coverage views. The table lists every job in stage order then file order, under the
catalogue's column-heading voice: the job id as a pressed-state button in 12px monospace, the stage
and the needs in 12px monospace `text-secondary` ("None" in sans `text-muted` when there are none),
and on the Coverage view every layer tag, the chosen layer first. It does not zoom: on a forty-job
pipeline, where `fitView` takes node text below the 11px floor, it is the legible way to read the
pipeline. A row opens its job like a node does, and closing the panel returns focus to the row.

### Job Search

A `surface-1` band under the header, in the flow like the partial pipeline bar and ruled by the same
hairline, capped at one third of the viewport. It holds a combobox in the field style, named "Find a
job", above a listbox of job ids in 12px monospace with their stage in 11px monospace `text-muted`.
Prefix matches come first, then inner matches, each in file order. Up and Down move the active
option (`surface-3` fill, `text-primary`), Enter or a click opens the job — its detail panel, and
focus on its node — and Escape closes the band and returns focus to `Find job`. It covers nothing,
so it does not trap focus. When nothing matches, one `role="status"` sentence says so.

### Partial Pipeline Bar

A `surface-1` band under the header, on every view, present when the pipeline has unresolved
includes. It is a hairline-ruled `role="group"` capped at one third of the viewport, 6px 12px padded
like a banner, and holds one disclosure. The summary row, a 32px target, reads: an SVG chevron that
rotates a quarter turn when open, "Partial pipeline" in the label voice, the unresolved count in 11px
monospace `text-muted`, then one sentence in 13px `text-secondary`. Open, each entry shows a tag with
the include's form, its value in 12px monospace, "declared in" in the label voice, and the declaring
file in 12px monospace `text-muted`.

It has no severity hue, no `Dismiss` button and no live region, and its entries are not clickable.

### Coverage Panel

The left sidebar's content on the Coverage view, with 16px between its blocks: a 13px `text-secondary`
count of OWASP layers and platform categories, a lower-bound sentence when the pipeline is partial,
then three sections under the 13px semibold section heading — "Uncovered OWASP layers", "Platform
categories not seen", "Covered layers". Each section with nothing to list says so in one `text-muted`
sentence.

- **Uncovered entry:** a layer tag beside the layer's name in 13px `text-primary`, its summary in 13px
  `text-secondary`, then a 12px row of text links, "See tools" and, for an OWASP layer, "OWASP
  guideline".
- **Covered entry:** a full-width `button` with `aria-pressed`, 3px radius, 4px padding and a
  transparent one-pixel border that turns `accent` when pressed; `surface-3` fill on hover. A layer
  tag sits beside the layer's name in 13px `text-secondary`, over its job ids in 11px monospace
  `text-muted`. Pressing it emphasises that layer's job nodes on the graph.

### Toolchain

The Toolchain view keeps the three-column frame. The side column leads with the pending decisions,
`Proposed integrations` and their count, then `Services` with each service's integrations listed in
monospace, which is the keyboard reading of the graph, then `New service`, then `Dismissed` when it
has entries. The canvas places involved jobs left and services right, biased so a service sits near
its jobs; nodes drag freely and their positions live in `layout.json`, not in a token. A job node is
a plain `surface-1` card, since nothing about it is edited here; a service node is `surface-2` with
its logo or the generic mark, its name, and its tool. Service nodes leave the tab order because the
list already reaches them. An unreadable `toolchain.yaml` replaces the side column and the empty
canvas sentence with the reason, instead of reading as an empty toolchain.

### Catalogue

The Catalog view fills the main area. A wrapping filter form of three labelled selects (layer, license,
adapter), each at least 160px wide, sits above a hairline, followed by a `role="status"` count in 12px `text-muted`.

- **Tool table:** column headings in the label voice, rows ruled by `border-subtle`. The tool's name
  is a full-width `button` in 13px `text-primary` with `aria-pressed`, 3px radius and 4px padding,
  `surface-2` on hover, `surface-3` and semibold when pressed, with no accent. Beside it, layer tags
  and the licence identifier in 11px monospace `text-muted`. With no match, the table gives way to
  one `text-muted` sentence.
- **Tool panel:** the 352px panel on the right, with a hairline on its left edge: the logo and tool
  name at 19px semibold above a ghost `Close` button, every layer tag, a definition list in 13px with
  `text-muted` sentence-case terms, the "Homepage" link, then each adapter's snippet in the YAML
  viewer under a label, or a `text-muted` sentence when there is none.

### The Origin Badge (signature component)

The product's signature. A value a job inherited rather than declared carries a badge immediately
after it wherever the badge renders: an inline SVG inheritance mark, then Keelson's own wording in
the 11px small-caps label voice at weight 500 in `text-muted` ("inherited from", "from anchor", "from
reference", "from included file", "default"), then — where there is one — the source string from the
file in monospace `normal-case` `text-secondary`. It truncates rather than wrapping, and its `title`
states that editing the value writes an explicit override in this job and never touches the template
or the included file. On an included job the `title` says instead that the value cannot be overridden
here.

The badge carries no fill, no border and no radius: it is pure type, because it appears many times
per screen and must not accumulate into visual noise. It renders on an editable job node beside the
stage name on the Pipeline view, and in the detail panel beside each field label on every view, and
the two instances are the same component at the same size. An included job node and every node on
the coverage overlay carry no badge; the detail panel keeps it for those jobs.

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
- **Do** let a layer's hue group its family and its word name it (The Family-Colour Rule).
- **Do** keep a job from an included file an object: one plane down, no hover, `border-default`, the
  word `read-only`, no editor (The Read-Only Object Rule).
- **Do** give a destructive action a confirmation that owns focus: `role="alertdialog"`,
  `aria-modal`, focus into the confirm button, Escape cancels without closing the panel behind it,
  focus back to the trigger (The Inline-Modal Rule).
- **Do** announce an in-flight write with `role="status"` and disable the controls it affects.
- **Do** give an unreadable or missing region an explicit, worded state rather than an empty box.
- **Do** animate only colour, only on hover and focus, only through `var(--duration-fast)` with
  `--ease-out`, so the reduced-motion collapse at the token layer keeps working without `!important`.
  The partial pipeline bar's chevron rotation is the one transform, on the same two tokens.
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
- **Don't** close a shape with `border-subtle` anywhere but the stage column. Every other use is a
  rule on one named edge; `packages/ui/test/tokens.test.ts` fails otherwise.
- **Don't** use uppercase outside the 11px label voice — no uppercase headings, no uppercase sentence
  buttons, and no uppercase standalone line of copy above a title (The Small-Caps Label Rule).
- **Don't** upper-case, truncate-in-the-middle or otherwise restyle a string that came from the user's
  file. It is data on screen.
- **Don't** use a text character as an icon (The Drawn-Mark Rule).
- **Don't** add a radius outside 3 / 5 / 8px, and don't give a full-bleed band a radius at all.
- **Don't** thicken a border to signal importance; move along the border ramp instead. The only 2px
  strokes are the focus ring and the layer emphasis, both outlines, and the only weighted stroke is
  the dependency edge, whose two weights are tokens.
- **Don't** introduce a light theme or a second accent hue; `color-scheme: dark` is a commitment and
  the severity and layer-family hues are the only other colours.
- **Don't** write a node size, column gap or row gap in TypeScript; it belongs in `tokens.css` and is
  read at runtime (The Tokenised Geometry Rule).
- **Don't** add breakpoint-specific styling to make the shell reflow on a narrow viewport. The one
  exception is ADR 0008: below `lg`, the job detail panel, the left sidebar and the tool panel become
  full-screen overlays. Any other reflow would be a new layout decision, not a fix.
- **Don't** smuggle in the rejected worlds: no revision bars or specification-sheet margins, no
  wiring-schematic ornament, no high-density Japanese grid, no transit-diagram line styling.
