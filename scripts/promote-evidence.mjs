import { getEvidenceCandidate, promoteEvidenceCandidate } from "../server/services/evidence-builder-service.mjs";

export async function runEvidencePromotion() {
  const { candidate } = await getEvidenceCandidate();
  const result = await promoteEvidenceCandidate({ expectedRevision: candidate.revision });
  console.log(`Promoted approved evidence to ${result.canonicalPath}`);
  return result;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try { await runEvidencePromotion(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
