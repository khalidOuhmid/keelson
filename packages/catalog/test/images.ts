/** What the snippets' images contain, read on 2026-11-12 from each registry: the `linux/amd64`
 *  image config (`Entrypoint`, `PATH`) and the listing of every layer, for the shells a GitLab
 *  runner looks for and the tool's executables. Nothing here was run: a snippet that agrees with
 *  these facts can still fail on what only a runner shows (network, tokens, the target). */
export type ImageFacts = {
  entrypoint: readonly string[] | null;
  path: readonly string[];
  /** The first shell the runner finds, `null` for a distroless or scratch image. */
  shell: string | null;
  /** Absolute paths of the executables the snippets call. */
  files: readonly string[];
  /** The image entrypoint does work the tool needs: overriding it breaks the tool. */
  keepEntrypoint?: string;
};

const SYSTEM = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

export const IMAGES: Readonly<Record<string, ImageFacts>> = {
  "aquasec/kube-bench:latest": {
    entrypoint: ["./entrypoint.sh"],
    path: [...SYSTEM, "/usr/local/mount-from-host/bin", "/go/bin"],
    shell: "/bin/bash",
    files: ["/usr/local/bin/kube-bench"],
  },
  "aquasec/trivy:latest": {
    entrypoint: ["trivy"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/usr/local/bin/trivy"],
  },
  "anchore/grype:latest": { entrypoint: ["/grype"], path: SYSTEM, shell: null, files: ["/grype"] },
  "anchore/grype:debug": {
    entrypoint: ["/grype"],
    path: [...SYSTEM, "/busybox"],
    shell: "/busybox/sh",
    files: ["/grype"],
  },
  "anchore/syft:latest": { entrypoint: ["/syft"], path: SYSTEM, shell: null, files: ["/syft"] },
  "anchore/syft:debug": {
    entrypoint: ["/syft"],
    path: [...SYSTEM, "/busybox"],
    shell: "/busybox/sh",
    files: ["/syft"],
  },
  "bridgecrew/checkov:latest": {
    entrypoint: ["/entrypoint.sh"],
    path: SYSTEM,
    shell: "/usr/bin/bash",
    files: ["/usr/local/bin/checkov"],
  },
  "checkmarx/kics:latest": {
    entrypoint: ["/app/bin/kics"],
    path: [...SYSTEM, "/app/bin"],
    shell: "/usr/bin/sh",
    files: ["/app/bin/kics"],
  },
  "chef/inspec:latest": {
    entrypoint: ["inspec"],
    path: ["/opt/inspec/bin", "/opt/inspec/embedded/bin", ...SYSTEM],
    shell: "/usr/bin/bash",
    files: ["/opt/inspec/bin/inspec"],
  },
  "cyclonedx/cyclonedx-cli:latest": {
    entrypoint: ["/cyclonedx"],
    path: ["/", ...SYSTEM],
    shell: "/usr/bin/bash",
    files: ["/cyclonedx"],
  },
  "getsentry/sentry-cli:latest": {
    entrypoint: ["/docker-entrypoint.sh"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/bin/sentry-cli"],
  },
  "hashicorp/vault:latest": {
    entrypoint: ["docker-entrypoint.sh"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/bin/vault"],
  },
  "sonarsource/sonar-scanner-cli:latest": {
    entrypoint: ["/usr/bin/entrypoint.sh"],
    path: ["/opt/sonar-scanner/bin", ...SYSTEM],
    shell: "/usr/bin/bash",
    files: ["/opt/sonar-scanner/bin/sonar-scanner"],
  },
  "ghcr.io/gitleaks/gitleaks:latest": {
    entrypoint: ["gitleaks"],
    path: SYSTEM,
    shell: "/bin/bash",
    files: ["/usr/bin/gitleaks"],
  },
  "ghcr.io/google/osv-scanner:latest": {
    entrypoint: ["/osv-scanner"],
    path: ["/go/bin", "/usr/local/go/bin", ...SYSTEM],
    shell: "/bin/sh",
    files: ["/osv-scanner"],
  },
  "ghcr.io/ossf/scorecard:latest": {
    entrypoint: ["/ko-app/v5"],
    path: [...SYSTEM, "/ko-app"],
    shell: null,
    files: ["/ko-app/v5"],
  },
  "ghcr.io/pycqa/bandit/bandit:latest": {
    entrypoint: ["bandit"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/usr/local/bin/bandit"],
  },
  "ghcr.io/securego/gosec:latest": {
    entrypoint: ["/bin/entrypoint.sh"],
    path: ["/go/bin", "/usr/local/go/bin", ...SYSTEM],
    shell: "/bin/bash",
    files: ["/bin/gosec"],
  },
  "ghcr.io/sigstore/cosign/cosign:latest": {
    entrypoint: ["/ko-app/cosign"],
    path: [...SYSTEM, "/ko-app"],
    shell: null,
    files: ["/ko-app/cosign"],
  },
  "ghcr.io/sigstore/cosign/cosign:latest-dev": {
    entrypoint: ["/ko-app/cosign"],
    path: [...SYSTEM, "/busybox", "/ko-app"],
    shell: "/busybox/sh",
    files: ["/ko-app/cosign"],
  },
  "ghcr.io/sullo/nikto:latest": {
    entrypoint: ["nikto.pl"],
    path: [...SYSTEM, "/opt/nikto"],
    shell: "/bin/sh",
    files: ["/opt/nikto/nikto.pl"],
  },
  "ghcr.io/terraform-linters/tflint:latest": {
    entrypoint: ["tflint"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/usr/local/bin/tflint"],
  },
  "gitguardian/ggshield:latest": {
    entrypoint: null,
    path: ["/app/.venv/bin", ...SYSTEM],
    shell: "/usr/bin/bash",
    files: ["/app/.venv/bin/ggshield"],
  },
  "openpolicyagent/conftest:latest": {
    entrypoint: ["/conftest"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/conftest", "/usr/local/bin/conftest"],
  },
  "openpolicyagent/opa:latest": {
    entrypoint: ["/opa"],
    path: [...SYSTEM, "/"],
    shell: null,
    files: ["/opa"],
  },
  "openpolicyagent/opa:latest-debug": {
    entrypoint: ["/opa"],
    path: [...SYSTEM, "/"],
    shell: "/usr/bin/sh",
    files: ["/opa"],
  },
  "owasp/dependency-check:latest": {
    entrypoint: ["/usr/share/dependency-check/bin/dependency-check.sh"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/usr/share/dependency-check/bin/dependency-check.sh"],
  },
  "projectdiscovery/nuclei:latest": {
    entrypoint: ["nuclei"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/usr/local/bin/nuclei"],
  },
  "prowlercloud/prowler:latest": {
    entrypoint: ["/home/prowler/.venv/bin/prowler"],
    path: ["/home/prowler/.local/bin", ...SYSTEM],
    shell: "/usr/bin/bash",
    files: ["/home/prowler/.venv/bin/prowler"],
  },
  "renovate/renovate:latest": {
    entrypoint: ["/usr/local/sbin/renovate-entrypoint.sh"],
    path: ["/home/ubuntu/bin", ...SYSTEM],
    shell: "/usr/bin/bash",
    files: ["/usr/local/sbin/renovate"],
  },
  "schemathesis/schemathesis:stable": {
    entrypoint: ["schemathesis"],
    path: ["/opt/venv/bin", "/opt/python/bin", ...SYSTEM],
    shell: "/bin/sh",
    files: ["/opt/venv/bin/schemathesis", "/opt/venv/bin/st"],
  },
  "semgrep/semgrep:latest": {
    entrypoint: null,
    path: SYSTEM,
    shell: "/bin/bash",
    files: ["/usr/bin/semgrep"],
  },
  "stoplight/spectral:latest": {
    entrypoint: ["sh", "-c", 'node /usr/local/lib/scarf-telemetry.js & exec spectral "$@"', "sh"],
    path: SYSTEM,
    shell: "/bin/sh",
    files: ["/usr/local/bin/spectral"],
  },
  "trufflesecurity/trufflehog:latest": {
    entrypoint: ["/etc/entrypoint.sh"],
    path: SYSTEM,
    shell: "/bin/bash",
    files: ["/usr/bin/trufflehog"],
    keepEntrypoint:
      "it runs git config --global --add safe.directory '*', and the image has no .gitconfig: a checkout owned by the runner's user is refused by git otherwise",
  },
  "zaproxy/zap-stable:latest": {
    entrypoint: null,
    path: ["/usr/lib/jvm/java-17-openjdk-amd64/bin", "/zap", ...SYSTEM],
    shell: "/usr/bin/bash",
    files: ["/zap/zap-baseline.py"],
  },
};
