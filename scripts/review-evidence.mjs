import fs from "node:fs/promises";
import { getEvidenceCandidate, reviewEvidenceCandidate } from "../server/services/evidence-builder-service.mjs";

export async function runEvidenceReview(decisionsPath) {
  if (!decisionsPath) throw new Error("Usage: node scripts/review-evidence.mjs <decisions.json>");
  const payload = JSON.parse(await fs.readFile(decisionsPath, "utf8"));
  const decisions = Array.isArray(payload) ? payload : payload.decisions;
  if (!Array.isArray(decisions) || decisions.length === 0) throw new Error("Decisions file must contain a non-empty array of decisions.");
  const { candidate } = await getEvidenceCandidate();
  return reviewEvidenceCandidate(decisions, { expectedRevision: candidate.revision });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = await runEvidenceReview(process.argv[2]);
    console.log(`Reviewed candidate. Status: ${result.report.status.toUpperCase()}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
