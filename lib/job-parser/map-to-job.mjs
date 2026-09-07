import fs from "node:fs/promises";
import Ajv from "ajv";
import { assertExtraction } from "./extraction-contract.mjs";

const schema = JSON.parse(await fs.readFile(new URL("../../schemas/job.schema.json", import.meta.url), "utf8"));
const validateJob = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile(schema);

const issue = (code, path, message, details = {}) => ({ code, path, message, ...details });

export function mapToJob(extraction) {
  assertExtraction(extraction);
  const errors = [];
  const job = {};
  const metadata = extraction.metadata ?? {};
  for (const key of ["company", "title"]) {
    if (metadata[key]) job[key] = metadata[key].value;
    else errors.push(issue("missing_metadata", `/metadata/${key}`, `Missing required metadata: ${key}.`));
  }
  if (metadata.employmentType) job.type = metadata.employmentType.value;
  if (metadata.sourceUrl) job.source = { url: metadata.sourceUrl.value };
  if (metadata.location) errors.push(issue("unsupported_metadata", "/metadata/location", "Location has no established legacy field mapping."));
  const requirements = { required: [], preferred: [], competencies: [] };
  const responsibilities = [];
  extraction.items.forEach((item, index) => {
    const path = `/items/${index}`;
    if (item.type === "alternative") {
      errors.push(issue("unsupported_alternative", path, "Legacy flat arrays cannot preserve any-of semantics.", { values: item.values }));
    } else if (item.kind === "responsibility") {
      responsibilities.push(item.value);
    } else if (item.kind === "ambiguous" || item.classification === "ambiguous") {
      errors.push(issue("ambiguous_item", path, "Ambiguous items cannot be safely projected into the legacy job format.", { value: item.value }));
    } else if (item.kind === "competency") {
      requirements.competencies.push(item.value);
    } else if (item.classification === "required") {
      requirements.required.push(item.value);
    } else if (item.classification === "preferred") {
      requirements.preferred.push(item.value);
    } else {
      errors.push(issue("unsupported_classification", path, "Item classification has no legacy mapping.", { value: item.value }));
    }
  });
  if (requirements.required.length || requirements.preferred.length || requirements.competencies.length) job.requirements = requirements;
  if (responsibilities.length) job.responsibilities = responsibilities;
  if (errors.length) return { valid: false, job: null, errors };
  if (!validateJob(job)) return { valid: false, job: null, errors: [issue("final_schema", "/", "Mapped job failed final schema validation.", { details: validateJob.errors })] };
  return { valid: true, job, errors: [] };
}
