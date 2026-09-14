import fs from "node:fs/promises";
import { buildEvidence } from "../server/services/evidence-builder-service.mjs";

function usage() { return "Usage: node scripts/build-evidence.mjs <base.json>"; }

export async function runEvidenceBuilder(args) {
  const [input, ...flags] = args;
  if (!input) throw new Error(usage());
  const resume = JSON.parse(await fs.readFile(input, "utf8"));
  if (flags.length > 0) throw new Error(`${usage()} Review and promotion require explicit structured commands.`);
  return buildEvidence({ resume, sourceReference: input });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = await runEvidenceBuilder(process.argv.slice(2));
    console.log(`Candidate facts: ${result.report.summary.factsExtracted}`);
    console.log(`Status: ${result.report.status.toUpperCase()}`);
    console.log(`Generated:\n  ${result.paths.candidate}\n  ${result.paths.report}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
