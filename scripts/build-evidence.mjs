import fs from "node:fs/promises";
import { buildEvidence } from "../server/services/evidence-builder-service.mjs";

function usage() { return "Usage: node scripts/build-evidence.mjs <base.json> [--sources <sources.json>]"; }

function parseSourcePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.supportingSources)) return payload.supportingSources;
  throw new Error("Sources JSON must be an array or an object with a supportingSources array.");
}

export async function runEvidenceBuilder(args, { build = buildEvidence } = {}) {
  const [input, ...flags] = args;
  if (!input) throw new Error(usage());
  let sourcesPath = null;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag !== "--sources") throw new Error(`${usage()} Unknown argument: ${flag}`);
    if (sourcesPath) throw new Error(`${usage()} --sources may be specified only once.`);
    const value = flags[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${usage()} --sources requires a JSON file path.`);
    sourcesPath = value;
    index += 1;
  }
  const resume = JSON.parse(await fs.readFile(input, "utf8"));
  const supportingSources = sourcesPath ? parseSourcePayload(JSON.parse(await fs.readFile(sourcesPath, "utf8"))) : undefined;
  return build({ resume, sourceReference: input, supportingSources });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = await runEvidenceBuilder(process.argv.slice(2));
    console.log(`Candidate facts: ${result.report.summary.factsExtracted}`);
    const types = [...new Set((result.candidate?.supportingSources ?? []).map((source) => source.type))];
    if (types.length) console.log(`Supporting sources: ${result.candidate.supportingSources.length} (${types.join(", ")})`);
    console.log(`Status: ${result.report.status.toUpperCase()}`);
    console.log(`Generated:\n  ${result.paths.candidate}\n  ${result.paths.report}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
