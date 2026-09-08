import { pathToFileURL } from "node:url";
import path from "node:path";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";

// Uses the production provider schema and a small synthetic JD. No files written.
export async function runSmokeTest({ provider = createGeminiProvider() } = {}) {
  const document = preprocessJobDescription("Company: Example\nPosition: Engineer\n\nRequirements\n- Node.js is required\n\nPreferred Qualifications\n- Java or Kotlin is preferred");
  const extraction = await provider({ ...document, unresolved: [] });
  const evidence = validateEvidence(document, extraction);
  if (!evidence.valid) throw new Error(`SMOKE_EVIDENCE_ERROR: ${JSON.stringify(evidence.errors)}`);
  const mapped = mapToJob(extraction);
  if (!mapped.valid) throw new Error(`SMOKE_MAPPING_ERROR: ${JSON.stringify(mapped.errors)}`);
  if (mapped.job.company !== "Example" || mapped.job.title !== "Engineer"
    || !extraction.items.some(item => item.type === "item" && item.classification === "required" && /Node\.js/u.test(item.value))
    || !extraction.items.some(item => item.type === "alternative" && item.classification === "preferred" && item.values.includes("Java") && item.values.includes("Kotlin"))) {
    throw new Error("SMOKE_CONTENT_ERROR: Expected metadata, required Node.js, or preferred Java/Kotlin group missing.");
  }
  return mapped.job;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runSmokeTest();
    console.log("Smoke test passed: API request, extraction, evidence, and mapping. Full-JD compatibility is not yet verified.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
