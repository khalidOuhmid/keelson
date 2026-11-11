# keelson

Design a DevSecOps chain visually before you build it.

```sh
npx keelson start
```

Keelson reads your native CI YAML (GitLab CI, GitHub Actions), maps every job to the 13 layers of
the OWASP DevSecOps Guideline, models the platform services around the pipeline (Vault, Harbor,
DefectDojo, Nexus…), and proposes catalogued tools for the layers you do not cover yet. GitLab CI
is edited in place, byte for byte; GitHub Actions workflows are read and mapped.

Runs locally on Node ≥ 20. Nothing leaves your machine. Full documentation:
<https://github.com/khalidOuhmid/keelson#readme>.

Apache-2.0.
