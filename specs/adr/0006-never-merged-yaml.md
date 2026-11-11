# ADR 0006 — Never merged YAML: merging is a chain of definitions

Date: 2026-10-23 · Decided by: the autopilot · Status: accepted

## Context

GitLab merges the configuration of the `include`s and then applies the main file on top:
"After all configuration added with `include` is merged together, the main configuration is merged
with the included configuration" (<https://docs.gitlab.com/ci/yaml/includes/>, accessed on
2026-10-23). Maps are deep-merged, lists overwrite.

Keelson must return an IR that reflects this effective value, **and** keep the ability to edit in
place: every IR element carries a byte range, and `apply` rewrites by splicing without ever
regenerating the document.

## Options

**A. Build a merged document.** Construct a YAML — or a CST — that is the result of the merge, then
parse it as a single file. The IR would be correct, and every range would be an offset into a text
**that exists on no disk**. In-place editing becomes impossible: you cannot rewrite a byte of a file
from a position in a synthetic document, and the invariant "parse → emit without changes returns
identical bytes" loses its meaning.

**B. An ordered chain of definitions.** Each file keeps its own CST. For a top-level key defined in
several files, we keep the **list** of its definitions in merge order, and resolving a value takes
the last one that declares it — exactly the mechanism that already resolves `extends` and merge
anchors in `resolve.ts`.

## Decision

**B.** Keelson never builds merged YAML. `sourcesFor` takes a list of `Definition`
(`{ map, file }`) instead of a single map, and `matches(...).at(-1)` gives the winning value.

## Consequences

- Ranges stay **true within their file**. That is why `Job`, `Template`, `Stage`, `OpaqueBlock` and
  `Diagnostic` all carry a `file`: a range without a file no longer locates anything as soon as
  there is more than one text. Reading an offset in the wrong text would display bytes taken from
  elsewhere, which is the most dangerous defect this milestone could introduce — on the only
  surface of the product whose promise is "this is verbatim".
- GitLab's merge order comes for free: it is enough to put the definitions in the right order and
  let `at(-1)` do the rest. The four cases — includes first, last included file wins, main file
  last, duplicates not deduplicated — are properties of the list, not of merge code.
- The **owner** of an element is its last contributor, hence the file a user would edit. A job
  coming from an include and redefined in the main file belongs to the main file and stays
  editable; a job that exists only in the include does not.
- `Origin` gains `{ kind: "include", file }`: a value coming from the same-named definition in
  another file says which one, just like a value coming from an `extends` or an anchor.
- What the decision does **not** provide: GitLab's full deep merge on keys the IR does not model.
  Two files that each define part of an `artifacts:` of the same job render, on screen, the opaque
  block of the last one, not their merge. Since the IR does not model `artifacts`, it cannot merge
  it without building precisely the document this decision refuses. A job's opaque blocks therefore
  come from **all** its definitions, deduplicated by key keeping the last one, each with its file —
  which is true of each block taken in isolation, and incomplete for their combination.
