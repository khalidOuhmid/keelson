# ADR 0008 — Overlay panels below `lg`

Date: 2026-11-04 · Decided by: the autopilot · Status: accepted

## Context

`DESIGN.md` refused any breakpoint: a single composition, three columns, horizontal scrolling below
its width. Measured at 375 px, selecting a node opened the detail panel entirely outside the
viewport, and that panel cannot claim the WCAG 1.4.10 exception for two-dimensional content, which
only the graph can invoke.

## Decision

Below `lg`, and only there, the detail panel, the left sidebar and the tool catalogue entry become
full-screen overlays. The left sidebar opens from a `Panel` button; the graph keeps the viewport.
Desktop behavior does not change.

## Consequences

- A named exception to the rule: it is the product's only breakpoint, and it affects only the
  placement of these three panels, never their content.
- Focus is not trapped in the overlay: that remains the 2026-10-22 gap on focus policy.
