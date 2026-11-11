# Security policy

Keelson runs a local HTTP server that reads and writes files in your repository. Reports about it
are taken seriously.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability). Do not open a public issue for a vulnerability.

You can expect an acknowledgement within 5 working days and a fix or a mitigation plan within 30.

## Scope

In scope: the local server (`keelson start`) — Host check, session token, path boundary, symlink
handling, request limits, atomic writes — the CLI, and the YAML round-trip (an edit that silently
changes bytes outside its target range is a security-relevant bug for a CI tool).

The threat model is described in [specs/01-plan.md §7b](specs/01-plan.md).
