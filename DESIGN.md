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
  border-default: "oklch(0.36 0.01 265)"
  border-strong: "oklch(0.48 0.012 265)"
  text-primary: "oklch(0.96 0.003 265)"
  text-secondary: "oklch(0.78 0.006 265)"
  text-muted: "oklch(0.63 0.008 265)"
  text-on-accent: "oklch(0.17 0.006 265)"
  accent: "oklch(0.68 0.16 258)"
  accent-hover: "oklch(0.74 0.16 258)"
  accent-muted: "oklch(0.35 0.07 258)"
  danger: "oklch(0.65 0.19 25)"
  danger-muted: "oklch(0.32 0.09 25)"
  warning: "oklch(0.78 0.14 75)"
  warning-muted: "oklch(0.34 0.07 75)"
  info: "oklch(0.72 0.09 230)"
  info-muted: "oklch(0.32 0.04 230)"
typography:
  xl:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "19px"
    lineHeight: "26px"
    fontWeight: 600
  lg:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "15px"
    lineHeight: "22px"
    fontWeight: 600
  base:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "13px"
    lineHeight: "20px"
    fontWeight: 400
  sm:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "12px"
    lineHeight: "18px"
    fontWeight: 400
  xs:
    fontFamily: "ui-monospace, \"SF Mono\", \"JetBrains Mono\", Menlo, Consolas, monospace"
    fontSize: "11px"
    lineHeight: "16px"
    fontWeight: 400
  2xs:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: "10px"
    lineHeight: "14px"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  sm: "3px"
  md: "5px"
  lg: "8px"
  pill: "999px"
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
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.2xs}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
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
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.2xs}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
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
hairline-ruled instrument panel for a CI pipeline. The whole system is one continuous dark field
(`surface-0`) onto which lighter planes are stacked a few percent of lightness at a time, divided
by one-pixel rules rather than by shadows or gaps. Nothing floats, nothing glows, nothing is
decorative. The reader's eye is meant to go to the pipeline, not to the chrome around it.

The world is the category standard played straight — stage columns, job cards, dependency edges,
interface sans-serif, dark by default — executed at the finish level of Linear, Vercel and Raycast
without borrowing their layout. Density is the aesthetic: the body size is 13px, labels run at
10px, and the ramp tops out at 19px. There is exactly one accent, a cool blue at 258°, and it is
reserved for two jobs: marking the selected object and marking focus. Everything that is not
selection, focus or a diagnostic severity is grey.

Colour never carries meaning alone. Diagnostic severities pair a hue with the severity word spelled
out and a distinct mark, so an error is legible as an error in monochrome. Motion is a single
140ms colour fade on hover and focus; there is no entrance animation, no layout animation, and no
easing curve applied to anything but colour. Reduced motion is honoured by collapsing the duration
tokens to `0ms` at the token layer, so no component carries an override.

**Key Characteristics:**

- Dark-only, five finely stepped surface planes in OKLCH at a near-neutral 265° hue.
- One-pixel borders everywhere; no shadow is rendered anywhere in the shipped UI.
- A single cool-blue accent, used only for selection and focus.
- A compressed 10 / 11 / 12 / 13 / 15px interface ramp on a 4px spacing base.
- Monospace for every value read from the YAML file; sans-serif for every label about it.
- Every inherited value carries an origin badge stating where it came from.

## Colors

A near-neutral blue-grey field (hue 265°, chroma under 0.012) with one cool-blue accent and three
severity hues that appear only inside diagnostics and banners.

### Primary

- **Signal Blue** (`accent`): the only accent in the product. It marks the selected job node's
  border, the focused field's border, and the 2px focus ring drawn globally on `:focus-visible`. It
  is never used as a fill behind text.
- **Signal Blue Bright** (`accent-hover`): the lifted step of the accent, reserved for an accent
  hover state. *No component consumes it today.*
- **Signal Blue Deep** (`accent-muted`): the recessed accent, reserved for accent-tinted fills and
  borders in the manner of the severity-muted tokens. *No component consumes it today.*

### Secondary

The severity family. These are the only hues besides the accent, and each is paired with a word and
a mark, never used alone.

- **Alert Red** (`danger`) and **Alert Red Deep** (`danger-muted`): error diagnostics, the error
  banner (muted at 20% as a fill, solid as a border), the destructive button's text and border, and
  the invalid-document state's container border.
- **Caution Amber** (`warning`) and **Caution Amber Deep** (`warning-muted`): warning diagnostics,
  the stale-write notice bar, and the alert tone of the empty-state container border.
- **Notice Blue** (`info`) and **Notice Blue Deep** (`info-muted`): informational diagnostics and
  the reloaded notice bar. Distinct from the accent in chroma and hue (230° vs 258°) so an info
  diagnostic never reads as a selection.

### Neutral

- **Floor** (`surface-0`): the application background, the canvas behind the graph, and every
  full-bleed state screen.
- **Plane** (`surface-1`): every chrome panel — left sidebar, job detail panel, diagnostics strip,
  stage column body, state containers. One step up from the floor.
- **Card** (`surface-2`): the job node at rest, and the diagnostics row on hover.
- **Card Raised** (`surface-3`): the job node on hover and when selected, the origin badge's fill,
  and the hover fill of every ghost button.
- **Well** (`surface-inset`): below the floor. Only input fields and the read-only YAML viewer use
  it; it is how the system says "editable or verbatim text goes here".
- **Rule Faint** (`border-subtle`): the structural dividers — header underline, panel edges,
  diagnostics row separators, stage column outline.
- **Rule** (`border-default`): the border of interactive objects — fields, buttons, tags, origin
  badges, unselected job nodes.
- **Rule Strong** (`border-strong`): the graph's connection handles.
- **Paper White** (`text-primary`): headings, job ids, diagnostic messages, field values.
- **Paper Dim** (`text-secondary`): body prose, button text, monospace values inside panels.
- **Paper Faint** (`text-muted`): uppercase labels, counts, stage names under a job id, disabled
  text, and every "empty" sentence ("No dependencies.", "No diagnostics.").
- **Ink On Accent** (`text-on-accent`): the dark text intended for a filled-accent surface.
  *No filled-accent surface exists today, so nothing consumes it.*

### Named Rules

**The Two-Job Accent Rule.** The accent means exactly two things: *this is selected* and *this has
focus*. Any other use — an accent-filled button, an accent heading, an accent-tinted panel — is
outside the system.

**The Never-Hue-Alone Rule.** A state is never carried by colour alone. Every severity colour ships
with the severity word spelled out and a distinct mark beside it; every notice bar carries a word
label ("Not applied", "Reloaded", "Deleted") in a bordered chip.

**The Grey Default Rule.** A new surface starts entirely in the neutral ramp. A hue has to be
justified by selection, focus, or a diagnostic severity; "this feels important" is not a
justification.

## Typography

**Body Font:** the platform interface sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI",
Roboto, sans-serif`)
**Value/Mono Font:** the platform monospace (`ui-monospace, "SF Mono", "JetBrains Mono", Menlo,
Consolas, monospace`)

**Character:** there is no display face and no brand face. Keelson uses the reader's own system UI
font so the tool disappears into the desktop, and the system monospace for every string that came
out of the YAML file. The pairing is functional, not expressive: sans-serif means "Keelson is
telling you something", monospace means "this is the file".

### Hierarchy

The ramp is compressed — six steps across 10px to 19px — because the product's job is to show a
whole pipeline at once. Three weights exist (400, 500, 600) and only two are in general use.

- **xl** (semibold, 19px/26px): the top of the ramp. *Unused in the shipped UI;* the largest text
  rendered is the panel title at 15px.
- **lg** (semibold, 15px/22px): the job detail panel's job id and every state-screen heading. This
  is the de facto largest type in the product.
- **base** (regular 400, 13px/20px): the document default set on `body`, and the job node's job id
  at semibold.
- **sm** (regular, 12px/18px): prose inside panels and states, diagnostic messages, and the stage
  column name (semibold, monospace).
- **xs** (regular, 11px/16px): the working size for values and controls — every input, every button
  label, every monospace value in a panel, the file path in the header.
- **2xs** (semibold, 10px/14px, tracking 0.06em, uppercase): the label voice. Field labels, section
  labels, origin badges, tags, notice chips, severity words, counts.

### Named Rules

**The Monospace-Means-File Rule.** Monospace is reserved for text that exists in the user's YAML:
job ids as values, stage names, need targets, environment keys and values, diagnostic codes, file
paths, opaque blocks. Prose Keelson wrote is always sans-serif.

**The Small-Caps Label Rule.** Every label naming a field or a section is 10px semibold uppercase
at 0.06em tracking in `text-muted`. Uppercase appears nowhere else — never on a heading, never on a
button that reads as a sentence, never as a standalone line of marketing copy above a title.

**The Fifteen-Pixel Ceiling Rule.** No shipped surface sets type above 15px. Hierarchy comes from
weight and colour, not from size jumps.

## Layout

The shell is a fixed full-height frame, never a scrolling page. Top to bottom: the notice/error
banners (each a single 12px-padded row, present only when there is something to say), a 44px header
(`--keelson-header-height`) carrying the product name and the open file path on the left and the
undo/redo pair on the right, then the working row, then the diagnostics strip capped at one third
of the viewport height and scrolling internally.

The working row is three columns, each of which only exists when it has content: a 352px left
sidebar (`--keelson-panel-width`) holding the stage and job creation controls, the elastic graph
canvas in the middle, and a 352px right column holding the job detail panel above the job editor.
Both side columns scroll independently; the canvas never scrolls, it pans and zooms (0.3× to 1.6×).
Every column boundary is a one-pixel `border-subtle` rule, not a gap.

Spacing is a strict 4px base (`--spacing`). The steps in use are 2, 4, 6, 8, 10, 12, 16 and 24px:
2–6px inside a control, 8–12px between controls and as panel padding, 16px between groups within a
panel, 24px as the only generous value in the system (the state-screen gutter). Panel padding is
always 12px; state containers are 16px and cap their prose at `max-w-prose`.

The graph's geometry is itself tokenised and read from CSS at runtime, so layout and style share
one source: job nodes are 232px × 64px (`--keelson-node-width`, `--keelson-node-height`), columns
are separated by 72px (`--keelson-column-gap`), rows inside a column by 20px (`--keelson-row-gap`),
and the stage column header is 32px tall (`--keelson-column-header-height`). These four metrics are
handed to the layout engine; changing the CSS value changes the graph.

### Named Rules

**The Rule-Not-Gap Rule.** Regions are separated by a one-pixel border, never by whitespace alone
and never by a shadow. If two areas need distinguishing, draw the hairline.

**The Tokenised Geometry Rule.** Graph metrics live in `tokens.css` and are read at runtime. No
node size, column gap or row gap is ever written in TypeScript.

**The Conditional Column Rule.** Side columns are present or absent, never collapsed to a sliver.
The sidebar appears only when a pipeline is loaded and editable; the detail column appears only
when a job is selected.

## Elevation & Depth

Keelson is flat. Two shadow tokens are defined (`--shadow-raised`, `--shadow-overlay`) and **no
component in the shipped UI renders either one** — there is not a single `box-shadow` outside the
token file. Depth is entirely tonal: `surface-inset` reads as below the floor, `surface-0` is the
floor, and `surface-1` → `surface-2` → `surface-3` step upward about four percent of lightness at a
time. A one-pixel border does the rest of the work a shadow would do.

The only non-tonal depth cue is stacking inside the graph, where stage columns sit at z-index 0 and
job nodes at z-index 1 so a card reads as lying on its column.

### Shadow Vocabulary

- **`--shadow-raised`** (`0 1px 2px oklch(0 0 0 / 0.3)`): defined for a resting lift. Currently
  unused; if adopted it belongs on an element that is genuinely detached from its plane.
- **`--shadow-overlay`** (`0 8px 24px oklch(0 0 0 / 0.45)`): defined for a true overlay — a popover
  or dialog floating above the shell. Currently unused; the product has no overlay surfaces yet.

### Named Rules

**The Tonal-Depth Rule.** Depth is a surface step plus a hairline. Reach for the next `surface-*`
token before reaching for a shadow, and never use both to express the same boundary.

**The Overlay-Only Shadow Rule.** The two shadow tokens exist for elements that leave the document
plane. Panels, cards, nodes, banners and buttons are part of the plane and stay flat.

## Shapes

Everything is a rectangle with a small, considered radius. The scale is tight and semantic rather
than decorative: 3px (`rounded.sm`) for small controls — inputs, buttons, tags, origin badges,
severity marks, the YAML viewer; 5px (`rounded.md`) for the job node, which is the only object at
that step and is therefore immediately distinguishable from both the controls below it and the
column behind it; 8px (`rounded.lg`) for the two large containers — the stage column and the
state-screen card. A pill radius (`rounded.pill`, 999px) is defined but nothing uses it.

Banners, headers, panels and the diagnostics strip have no radius at all: they are full-bleed bands
bounded by their hairline. Every border in the product is one pixel
(`--border-width-hairline: 1px`); there is no 2px border anywhere, and the only 2px stroke is the
focus ring. Dependency edges are drawn as curves between left/right handles, with optional needs
rendered as a 4px dash (`--keelson-edge-dash`).

### Named Rules

**The Three-Radius Rule.** 3px for controls, 5px for job nodes, 8px for containers. Full-bleed
bands get none. A fourth radius has to displace one of these, not join them.

**The One-Pixel Rule.** Borders are one pixel. Weight is expressed by moving along the
`border-subtle` → `border-default` → `border-strong` ramp, never by thickening the line.

## Components

### Buttons

Ghost by default. There is no filled button anywhere in the product.

- **Shape:** tightly rounded corners (3px).
- **Default:** transparent fill, one-pixel `border-default`, `text-secondary` label at 11px,
  padding 4px 8px (2px vertical in the header's history pair).
- **Hover / Focus:** fill fades to `surface-3` over 140ms with the `ease-out` curve; focus draws the
  global 2px accent ring at 2px offset.
- **Disabled:** label drops to `text-muted`, the cursor becomes `not-allowed`, and the hover fill is
  suppressed so the control cannot look responsive.
- **Danger:** same ghost geometry with a `danger-muted` border and `danger` label; hover fills with
  `danger-muted` at 30%. Used for destructive actions only (Delete job).

### Chips

Two kinds, both built from the label voice (10px uppercase, 0.06em tracking, 3px radius, one-pixel
border, 4px horizontal padding) and both borderless of fill except where a tone demands it.

- **Tag:** transparent with a `border-default` outline and `text-muted` text. Marks a qualifier on a
  value — `optional`, `no artifacts`, `read-only`, `implicit`.
- **Notice chip:** `border-current` so it inherits the banner's severity colour, semibold. Carries
  the word that makes the banner's colour redundant.

### Cards / Containers

- **Job node:** 232px × 64px, 5px radius, `surface-2` fill, one-pixel border that is
  `border-default` at rest and `accent` when selected; `surface-3` fill on hover and when selected.
  Padding 8px 10px. Two lines: the job id at 13px semibold `text-primary`, then the stage name in
  11px monospace `text-muted` followed by its origin badge.
- **Stage column:** 8px radius, `surface-1` fill, `border-subtle` outline, with a 32px header
  underlined by another hairline. The header carries the stage name (12px semibold monospace), an
  `implicit` tag when the stage is not declared in the file, and a right-aligned tabular job count.
  It is a `role="group"` with an accessible name, never a landmark.
- **Panel:** `surface-1`, no radius, 12px padding, bounded by a hairline on the edge that faces the
  canvas, 16px between its sections.
- **State card:** 8px radius, `surface-1` on the bare floor, 16px padding, prose capped at
  `max-w-prose`, heading at 15px semibold. The alert tone swaps the `border-subtle` outline for
  `warning-muted` (or `danger-muted` for an invalid document) and adds `role="alert"`.

### Inputs / Fields

- **Style:** full-width, 3px radius, one-pixel `border-default`, `surface-inset` fill (recessed
  below the floor), 11px monospace `text-primary`, padding 4px 6px. Inputs and selects share one
  class so a dropdown and a text field are indistinguishable in weight.
- **Focus:** the border becomes `accent` over 140ms, under the global 2px accent focus ring.
- **Disabled:** text drops to `text-muted` with a `not-allowed` cursor; the recessed fill stays, so
  a disabled field still reads as a field.
- **Label:** always the 10px uppercase label voice above the control, in a 6px-gap vertical group.

### Navigation

Keelson has no navigation in the site sense. The 44px header is an identity-and-state bar: the
product name at 12px semibold, the open file path beside it in 11px monospace `text-muted`
truncating from the end, and the undo/redo ghost pair on the right with their keyboard shortcuts in
the title attribute. It is underlined by a hairline and sits on the floor colour.

### Diagnostics Strip

A `surface-1` band along the bottom, capped at one third of the viewport, underlined from the
working row by a hairline. Its header pairs the 10px uppercase word "Diagnostics" with a tabular
count. Rows are separated by hairlines (the last one suppressed), sorted error → warning → info,
and each row is a three-part read: a 16px square severity mark in a 3px-radius box tinted by the
severity's `*-muted` border and `*` text colour, the severity word in the label voice, then the
diagnostic code in 11px monospace `text-secondary` above the message in 12px `text-primary`. A row
with a source range is a button and fills `surface-2` on hover; a row without one is a plain div
that does not pretend to be clickable.

### The Origin Badge (signature component)

The product's signature. Any value a job inherited rather than declared carries a small badge
immediately after it: 3px radius, `surface-3` fill, one-pixel `border-default`, 10px uppercase
`text-secondary` at 0.06em tracking, a leading decorative mark, and the inherited source as its
text ("inherited from .base", "default", "from anchor &defaults", "from !reference [...]"). It
truncates rather than wrapping. Its `title` states that editing the value writes an explicit
override in this job and never touches the template.

The badge is deliberately quiet — it uses no hue at all — because it appears many times per screen.
It renders on the job node beside the stage name and in the detail panel beside each field label,
and the two instances are the same component at the same size.

## Do's and Don'ts

### Do:

- **Do** take every colour, size, radius, duration and graph metric from `packages/ui/src/tokens.css`.
  A test enforces that no component hard-codes a value.
- **Do** keep the accent to selection and focus only (The Two-Job Accent Rule).
- **Do** separate regions with a one-pixel border from the `border-subtle` → `border-default` →
  `border-strong` ramp (The Rule-Not-Gap Rule, The One-Pixel Rule).
- **Do** express depth by stepping a surface token, not by adding a shadow (The Tonal-Depth Rule).
- **Do** set every value that came out of the user's YAML in monospace, and everything Keelson wrote
  in the interface sans (The Monospace-Means-File Rule).
- **Do** pair every severity colour with the severity word and a distinct mark (The Never-Hue-Alone
  Rule).
- **Do** animate only colour, only on hover and focus, only through `var(--duration-*)` with
  `--ease-out`, so the reduced-motion collapse at the token layer keeps working without `!important`.
- **Do** give every container-like grouping `role="group"` with an `aria-label` rather than a
  `<section aria-label>`, so stage columns and opaque blocks stay out of the landmark list.
- **Do** keep a 352px side column and a 44px header; read them from `--keelson-panel-width` and
  `--keelson-header-height`.

### Don't:

- **Don't** render a `box-shadow` on a panel, card, node, banner or button. The shipped UI has none,
  and the two shadow tokens are reserved for surfaces that leave the document plane.
- **Don't** introduce a filled accent button or an accent-tinted panel; there is no filled-accent
  surface in the system and `text-on-accent` has no consumer.
- **Don't** set type above 15px on a shipped surface, and don't add a size between the existing
  steps (The Fifteen-Pixel Ceiling Rule).
- **Don't** use uppercase for anything but the 10px label voice — no uppercase headings, no
  uppercase standalone line above a title, no uppercase sentence buttons (The Small-Caps Label Rule).
- **Don't** add a radius outside 3 / 5 / 8px, and don't give a full-bleed band a radius at all.
- **Don't** thicken a border to signal importance; move along the border ramp instead. The only 2px
  stroke in the product is the focus ring.
- **Don't** introduce a light theme or a second accent hue; `color-scheme: dark` is a commitment,
  and the severity hues are the only other colours.
- **Don't** write a node size, column gap or row gap in TypeScript; it belongs in `tokens.css` and
  is read at runtime (The Tokenised Geometry Rule).
- **Don't** smuggle in the rejected worlds: no revision bars or specification-sheet margins, no
  wiring-schematic ornament, no high-density Japanese grid, no transit-diagram line styling.
- **Don't** express a state with hue alone, and don't rely on a mark whose meaning is only visual —
  the word has to be in the DOM.
