export type LayerSource = "owasp" | "platform";

export const LAYER_IDS = [
  "secrets",
  "sca",
  "sast",
  "iac",
  "supply-chain",
  "iast",
  "api",
  "dast",
  "cnapp",
  "infrastructure",
  "continuous",
  "compliance",
  "ai",
  "scm",
  "registry",
  "secrets-management",
  "vulnerability-aggregation",
  "code-quality",
  "observability",
  "runtime-security",
  "policy",
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

/** Twenty-one hues would be unreadable: the screen colours the family, and the word carries the layer. */
export type LayerFamily = "build" | "test" | "operate" | "platform";

export type Layer = {
  id: LayerId;
  name: string;
  short: string;
  family: LayerFamily;
  source: LayerSource;
  summary: string;
  /** Guideline section, relative to <https://github.com/OWASP/DevSecOpsGuideline>. The thirteen
   *  layers are a Keelson projection: the Guideline no longer lists them in this form, and none of
   *  its text (CC BY-SA 4.0) is reproduced here. `null` for a platform category. */
  guideline: string | null;
};

const PROCESS = "current-version/2-Process";

export const LAYERS: readonly Layer[] = [
  {
    id: "secrets",
    name: "Secrets in git",
    short: "Secrets",
    family: "build",
    source: "owasp",
    summary: "Finds credentials committed to a repository or its history.",
    guideline: `${PROCESS}/2-2-Develop/2-2-1-Pre-commit/2-2-1-2-Secrets-Management.md`,
  },
  {
    id: "sca",
    name: "Software composition analysis",
    short: "SCA",
    family: "build",
    source: "owasp",
    summary: "Checks third-party dependencies against known vulnerabilities.",
    guideline: `${PROCESS}/2-3-Build/2-3-2-Software-Composition-Analysis/2-3-2-1-Software-Composition-Analysis.md`,
  },
  {
    id: "sast",
    name: "Static analysis",
    short: "SAST",
    family: "build",
    source: "owasp",
    summary: "Finds security defects in source code without running it.",
    guideline: `${PROCESS}/2-3-Build/2-3-1-Static-Analysis/2-3-1-1-Static-Application-Security-Testing.md`,
  },
  {
    id: "iac",
    name: "Infrastructure as code",
    short: "IaC",
    family: "build",
    source: "owasp",
    summary: "Checks infrastructure definitions for insecure configuration.",
    guideline: `${PROCESS}/2-3-Build/2-3-4-Infrastructure-as-Code-Security/2-3-4-1-Infrastructure-as-Code-Scanning.md`,
  },
  {
    id: "supply-chain",
    name: "Supply chain",
    short: "Supply chain",
    family: "build",
    source: "owasp",
    summary: "Produces SBOMs, signs artifacts and attests their provenance.",
    guideline: `${PROCESS}/2-3-Build/2-3-6-Supply-Chain-Security/2-3-6-1-SBOM.md`,
  },
  {
    id: "iast",
    name: "Interactive testing",
    short: "IAST",
    family: "test",
    source: "owasp",
    summary: "Instruments a running application to observe flaws during tests.",
    guideline: `${PROCESS}/2-4-Test/2-4-1-Interactive-Application-Security-Testing.md`,
  },
  {
    id: "api",
    name: "API security",
    short: "API",
    family: "test",
    source: "owasp",
    summary: "Tests API contracts and behaviour for security defects.",
    guideline: `${PROCESS}/2-4-Test/2-4-4-API-Security.md`,
  },
  {
    id: "dast",
    name: "Dynamic testing",
    short: "DAST",
    family: "test",
    source: "owasp",
    summary: "Attacks a running application from the outside.",
    guideline: `${PROCESS}/2-4-Test/2-4-2-Dynamic-Application-Security-Testing.md`,
  },
  {
    id: "cnapp",
    name: "Cloud native protection",
    short: "CNAPP",
    family: "operate",
    source: "owasp",
    summary: "Assesses cloud accounts and clusters for risky posture.",
    guideline: `${PROCESS}/2-7-Operate/2-7-1-Cloud-Native-Security.md`,
  },
  {
    id: "infrastructure",
    name: "Infrastructure scanning",
    short: "Infrastructure",
    family: "operate",
    source: "owasp",
    summary: "Scans hosts, images and clusters for misconfiguration and known flaws.",
    guideline: `${PROCESS}/2-4-Test/2-4-5-Misconfiguration-Check.md`,
  },
  {
    id: "continuous",
    name: "Continuous scanning",
    short: "Continuous",
    family: "operate",
    source: "owasp",
    summary: "Keeps re-evaluating what is already deployed as new flaws appear.",
    guideline: `${PROCESS}/2-7-Operate/2-7-4-Vulnerability-Management.md`,
  },
  {
    id: "compliance",
    name: "Compliance",
    short: "Compliance",
    family: "operate",
    source: "owasp",
    summary: "Checks systems against a stated benchmark and keeps the evidence.",
    guideline: "current-version/3-Governance/3-1-Compliance-Auditing/3-1-1-Compliance-Auditing.md",
  },
  {
    id: "ai",
    name: "AI and LLM security",
    short: "AI",
    family: "test",
    source: "owasp",
    summary: "Tests models and LLM applications for abuse and unsafe behaviour.",
    guideline: `${PROCESS}/2-4-Test/2-4-6-AI-LLM-Application-Security-Testing.md`,
  },
  {
    id: "scm",
    name: "Source control",
    short: "SCM",
    family: "platform",
    source: "platform",
    summary: "Hosts the repositories the pipeline runs from.",
    guideline: null,
  },
  {
    id: "registry",
    name: "Artifact repositories and registries",
    short: "Registry",
    family: "platform",
    source: "platform",
    summary: "Stores the packages and images the pipeline produces.",
    guideline: null,
  },
  {
    id: "secrets-management",
    name: "Secrets management",
    short: "Vault",
    family: "platform",
    source: "platform",
    summary: "Holds the credentials jobs fetch at run time.",
    guideline: null,
  },
  {
    id: "vulnerability-aggregation",
    name: "Vulnerability aggregation",
    short: "Findings",
    family: "platform",
    source: "platform",
    summary: "Collects findings from every scanner into one place.",
    guideline: null,
  },
  {
    id: "code-quality",
    name: "Code quality server",
    short: "Quality",
    family: "platform",
    source: "platform",
    summary: "Tracks code quality measures across branches over time.",
    guideline: null,
  },
  {
    id: "observability",
    name: "Runtime observability",
    short: "Observability",
    family: "platform",
    source: "platform",
    summary: "Reports errors and metrics from what is running.",
    guideline: null,
  },
  {
    id: "runtime-security",
    name: "Runtime security",
    short: "Runtime",
    family: "platform",
    source: "platform",
    summary: "Detects suspicious behaviour in running workloads.",
    guideline: null,
  },
  {
    id: "policy",
    name: "Policy as code",
    short: "Policy",
    family: "platform",
    source: "platform",
    summary: "Expresses and enforces rules as versioned code.",
    guideline: null,
  },
];

export function isLayerId(value: string): value is LayerId {
  return (LAYER_IDS as readonly string[]).includes(value);
}

export function findLayer(id: LayerId): Layer {
  const layer = LAYERS.find((candidate) => candidate.id === id);
  if (layer === undefined) {
    throw new Error(`layer missing from the taxonomy: ${id}`);
  }
  return layer;
}
