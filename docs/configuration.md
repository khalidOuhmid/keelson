# Configuration

Keelson owns exactly two files, both under `.devsecops/` at the root of your repository. Everything
else — your pipeline — stays in your native CI YAML, which remains the source of truth.

| File | Holds | Written by |
| --- | --- | --- |
| `.devsecops/toolchain.yaml` | Platform services and their integrations with jobs | Keelson (patched in place) and you |
| `.devsecops/layout.json` | Node positions and per-job layer overrides | Keelson |

Both files are optional. A missing file is an empty toolchain or layout; the first edit creates it.
Both are meant to be committed and reviewed like code.

## `.devsecops/toolchain.yaml`

```yaml
version: 1

services:
  harbor-prod:            # a named instance: two Nexus on two environments are two services
    tool: harbor          # a catalogue entry id
    url: https://harbor.corp.example
    environment: production
  vault-prod:
    tool: vault
    url: https://vault.corp.example

integrations:             # confirmed links between a job and a service
  - job: deploy-production
    service: vault-prod
    kind: fetch-secret
  - job: sbom
    service: harbor-prod
    kind: push

dismissed:                # inferred integrations you rejected, so they are not proposed again
  - job: build-image
    tool: harbor
    kind: push
```

| Key | Type | Notes |
| --- | --- | --- |
| `version` | `1` | Required. |
| `services.<id>.tool` | string | A catalogue entry id (`harbor`, `vault`, `defectdojo`, `sonarqube`…). |
| `services.<id>.url` | string, optional | Where the instance lives. |
| `services.<id>.environment` | string, optional | Free text, e.g. `production`. |
| `integrations[].kind` | `push` \| `upload-report` \| `fetch-secret` \| `notify` | What the job does with the service. |
| `dismissed[]` | `{ job, tool, kind }` | Rejected proposals. |

**Inference proposes, the file decides.** Keelson reads job scripts and the GitHub actions a step
uses, and proposes integrations (for example `vault kv get` or `uses: hashicorp/vault-action` →
`fetch-secret` to a Vault service). A client image alone proposes nothing. A proposal becomes real only when you
confirm it, which writes it to `integrations`; dismissing it writes it to `dismissed`. A declared
service also counts towards coverage: a `vault` service covers the *secrets management* platform
category even before any job uses it.

Keelson edits this file with in-place patches, like your CI file: comments, key order and formatting
are preserved. A file it cannot read (invalid YAML, an unknown key, a duplicate service id) is never
overwritten; the UI reports it as `TOOLCHAIN_INVALID` until you fix it.

## `.devsecops/layout.json`

```json
{
  "version": 1,
  "layers": {
    "integration-tests": ["dast", "api"],
    "lint": []
  },
  "positions": {
    "vault-prod": { "x": 640, "y": 120 }
  }
}
```

| Key | Notes |
| --- | --- |
| `layers.<job>` | Replaces detection for that job: the listed layer ids, or `[]` to claim none. Use it when a custom script does what detection cannot see. |
| `positions.<node>` | Positions of nodes you moved in the toolchain view. |

Layer ids are listed in the [CLI reference](cli.md#keelson-coverage).

## Catalogue entries

The embedded catalogue lives in [`packages/catalog/tools/`](../packages/catalog/tools/), one YAML
file per tool. See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-tool-to-the-catalogue) to add one.

```yaml
id: trivy
name: 'Trivy'
kind: job                      # job (runs in the pipeline) or service (a platform instance)
layers: [sca, iac, infrastructure]
license: Apache-2.0
homepage: https://github.com/aquasecurity/trivy
verifiedAt: https://github.com/aquasecurity/trivy
logo: trivy                    # a simple-icons slug, or null
detect:
  images: ['aquasec/trivy']
  scripts: ['(^|[\s/])trivy\s']
  actions: ['aquasecurity/trivy-action']
snippets:
  gitlab: |
    trivy:
      stage: test
      image:
        name: aquasec/trivy:latest
        entrypoint: [""]
      script:
        - trivy fs --scanners vuln,secret,misconfig .
  github: |
    - name: Run Trivy
      run: docker run --rm -v "$PWD:/src" -w /src --entrypoint "" aquasec/trivy:latest trivy fs --scanners vuln,secret,misconfig .
lastVerified: 2026-11-04
```
