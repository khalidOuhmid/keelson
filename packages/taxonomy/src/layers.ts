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

export type Layer = {
  id: LayerId;
  name: string;
  source: LayerSource;
  summary: string;
  /** Section de la Guideline, relative à <https://github.com/OWASP/DevSecOpsGuideline>. Les treize
   *  couches sont une projection de Keelson : la Guideline ne les énumère plus sous cette forme,
   *  et rien de son texte (CC BY-SA 4.0) n'est repris ici. `null` pour une catégorie plateforme. */
  guideline: string | null;
};

const PROCESS = "current-version/2-Process";

export const LAYERS: readonly Layer[] = [
  {
    id: "secrets",
    name: "Secrets in git",
    source: "owasp",
    summary: "Finds credentials committed to a repository or its history.",
    guideline: `${PROCESS}/2-2-Develop/2-2-1-Pre-commit/2-2-1-2-Secrets-Management.md`,
  },
  {
    id: "sca",
    name: "Software composition analysis",
    source: "owasp",
    summary: "Checks third-party dependencies against known vulnerabilities.",
    guideline: `${PROCESS}/2-3-Build/2-3-2-Software-Composition-Analysis/2-3-2-1-Software-Composition-Analysis.md`,
  },
  {
    id: "sast",
    name: "Static analysis",
    source: "owasp",
    summary: "Finds security defects in source code without running it.",
    guideline: `${PROCESS}/2-3-Build/2-3-1-Static-Analysis/2-3-1-1-Static-Application-Security-Testing.md`,
  },
  {
    id: "iac",
    name: "Infrastructure as code",
    source: "owasp",
    summary: "Checks infrastructure definitions for insecure configuration.",
    guideline: `${PROCESS}/2-3-Build/2-3-4-Infrastructure-as-Code-Security/2-3-4-1-Infrastructure-as-Code-Scanning.md`,
  },
  {
    id: "supply-chain",
    name: "Supply chain",
    source: "owasp",
    summary: "Produces SBOMs, signs artifacts and attests their provenance.",
    guideline: `${PROCESS}/2-3-Build/2-3-6-Supply-Chain-Security/2-3-6-1-SBOM.md`,
  },
  {
    id: "iast",
    name: "Interactive testing",
    source: "owasp",
    summary: "Instruments a running application to observe flaws during tests.",
    guideline: `${PROCESS}/2-4-Test/2-4-1-Interactive-Application-Security-Testing.md`,
  },
  {
    id: "api",
    name: "API security",
    source: "owasp",
    summary: "Tests API contracts and behaviour for security defects.",
    guideline: `${PROCESS}/2-4-Test/2-4-4-API-Security.md`,
  },
  {
    id: "dast",
    name: "Dynamic testing",
    source: "owasp",
    summary: "Attacks a running application from the outside.",
    guideline: `${PROCESS}/2-4-Test/2-4-2-Dynamic-Application-Security-Testing.md`,
  },
  {
    id: "cnapp",
    name: "Cloud native protection",
    source: "owasp",
    summary: "Assesses cloud accounts and clusters for risky posture.",
    guideline: `${PROCESS}/2-7-Operate/2-7-1-Cloud-Native-Security.md`,
  },
  {
    id: "infrastructure",
    name: "Infrastructure scanning",
    source: "owasp",
    summary: "Scans hosts, images and clusters for misconfiguration and known flaws.",
    guideline: `${PROCESS}/2-4-Test/2-4-5-Misconfiguration-Check.md`,
  },
  {
    id: "continuous",
    name: "Continuous scanning",
    source: "owasp",
    summary: "Keeps re-evaluating what is already deployed as new flaws appear.",
    guideline: `${PROCESS}/2-7-Operate/2-7-4-Vulnerability-Management.md`,
  },
  {
    id: "compliance",
    name: "Compliance",
    source: "owasp",
    summary: "Checks systems against a stated benchmark and keeps the evidence.",
    guideline: "current-version/3-Governance/3-1-Compliance-Auditing/3-1-1-Compliance-Auditing.md",
  },
  {
    id: "ai",
    name: "AI and LLM security",
    source: "owasp",
    summary: "Tests models and LLM applications for abuse and unsafe behaviour.",
    guideline: `${PROCESS}/2-4-Test/2-4-6-AI-LLM-Application-Security-Testing.md`,
  },
  {
    id: "scm",
    name: "Source control",
    source: "platform",
    summary: "Hosts the repositories the pipeline runs from.",
    guideline: null,
  },
  {
    id: "registry",
    name: "Artifact repositories and registries",
    source: "platform",
    summary: "Stores the packages and images the pipeline produces.",
    guideline: null,
  },
  {
    id: "secrets-management",
    name: "Secrets management",
    source: "platform",
    summary: "Holds the credentials jobs fetch at run time.",
    guideline: null,
  },
  {
    id: "vulnerability-aggregation",
    name: "Vulnerability aggregation",
    source: "platform",
    summary: "Collects findings from every scanner into one place.",
    guideline: null,
  },
  {
    id: "code-quality",
    name: "Code quality server",
    source: "platform",
    summary: "Tracks code quality measures across branches over time.",
    guideline: null,
  },
  {
    id: "observability",
    name: "Runtime observability",
    source: "platform",
    summary: "Reports errors and metrics from what is running.",
    guideline: null,
  },
  {
    id: "runtime-security",
    name: "Runtime security",
    source: "platform",
    summary: "Detects suspicious behaviour in running workloads.",
    guideline: null,
  },
  {
    id: "policy",
    name: "Policy as code",
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
