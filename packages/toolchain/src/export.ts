import type { Coverage } from "@keelson/catalog";
import type { Pipeline, Toolchain } from "@keelson/core";
import { findLayer, LAYERS } from "@keelson/taxonomy";

/** `#` d'abord : les entités qui suivent en contiennent un. `%` neutralise les directives `%%`, et
 *  un saut de ligne ouvrirait une ligne que Mermaid lirait comme un commentaire ou une directive. */
const label = (text: string): string =>
  `"${text
    .replaceAll("#", "#35;")
    .replaceAll('"', "#quot;")
    .replaceAll("%", "#37;")
    .replace(/\s*\n\s*/g, " ")}"`;

/** Identifiants par position : les noms de jobs n'ont aucune forme garantie, Mermaid si. */
export function renderMermaid(pipeline: Pipeline, toolchain: Toolchain): string {
  // Par fichier : deux workflows peuvent porter un job du même nom.
  const keyOf = (job: { id: string; file: string }): string => JSON.stringify([job.file, job.id]);
  const jobId = new Map(pipeline.jobs.map((job, index) => [keyOf(job), `j${index}`]));
  const serviceId = new Map(toolchain.services.map((service, index) => [service.id, `v${index}`]));

  // Un job peut viser un stage que ce fichier ne déclare pas, un include distant par exemple.
  const names = [
    ...new Set([
      ...pipeline.stages.map((stage) => stage.name),
      ...pipeline.jobs.map((job) => job.stage.value),
    ]),
  ];
  const stages = names.flatMap((name, index) => {
    const jobs = pipeline.jobs.filter((job) => job.stage.value === name);
    return jobs.length === 0
      ? []
      : [
          `  subgraph s${index}[${label(name)}]`,
          ...jobs.map((job) => `    ${jobId.get(keyOf(job))}[${label(job.id)}]`),
          "  end",
        ];
  });

  const services = toolchain.services.map(
    (service) => `  ${serviceId.get(service.id)}[(${label(service.id)})]`,
  );

  const needs = pipeline.jobs.flatMap((job) =>
    (job.needs?.value ?? []).flatMap((need) => {
      // Dans le même fichier d'abord : GitLab permet un `needs` vers un fichier voisin.
      const elsewhere = pipeline.jobs.find((other) => other.id === need.job);
      const source =
        jobId.get(keyOf({ id: need.job, file: job.file })) ??
        (elsewhere === undefined ? undefined : jobId.get(keyOf(elsewhere)));
      const target = jobId.get(keyOf(job));
      if (source === undefined || target === undefined) {
        return [];
      }
      return [need.optional ? `  ${source} -.-> ${target}` : `  ${source} --> ${target}`];
    }),
  );

  const integrations = toolchain.integrations.flatMap((entry) => {
    const target = serviceId.get(entry.service);
    return target === undefined
      ? []
      : pipeline.jobs
          .filter((job) => job.id === entry.job)
          .map((job) => `  ${jobId.get(keyOf(job))} -->|${entry.kind}| ${target}`);
  });

  return `${["flowchart LR", ...stages, ...services, ...needs, ...integrations].join("\n")}\n`;
}

const cell = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll("|", "\\|");

export function renderCoverageMarkdown(result: Coverage): string {
  const covered = (source: "owasp" | "platform"): number =>
    result.layers.filter((entry) => entry.covered && findLayer(entry.layer).source === source)
      .length;
  const count = (source: "owasp" | "platform"): number =>
    LAYERS.filter((layer) => layer.source === source).length;

  const rows = result.layers.map((entry) => {
    const { name } = findLayer(entry.layer);
    const jobs = entry.jobs.map(cell).join(", ");
    const services = entry.services.map(cell).join(", ");
    return `| ${name} | ${entry.covered ? "yes" : "no"} | ${jobs} | ${services} |`;
  });

  return [
    "# Coverage report",
    "",
    `${covered("owasp")} of ${count("owasp")} OWASP layers covered, ${covered("platform")} of ${count("platform")} platform categories seen.`,
    ...(result.partial
      ? ["", "Coverage is a lower bound: part of the pipeline could not be read."]
      : []),
    "",
    "| Layer | Covered | Jobs | Services |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
