import fs from "node:fs/promises";
import Ajv from "ajv";
import { assertExtraction } from "./extraction-contract.mjs";
import { validateAlternativeSemantics } from "../job-requirements/alternatives.mjs";

const schema = JSON.parse(await fs.readFile(new URL("../../schemas/job.schema.json", import.meta.url), "utf8"));
const validateJob = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile(schema);

const issue = (code, path, message, details = {}) => ({ code, path, message, ...details });

export function mapToJob(extraction) {
  assertExtraction(extraction);
  const errors = [];
  const warnings = [];
  const job = {};
  const metadata = extraction.metadata ?? {};
  for (const key of ["company", "title"]) {
    if (metadata[key]) job[key] = metadata[key].value;
    else errors.push(issue("missing_metadata", `/metadata/${key}`, `Missing required metadata: ${key}.`));
  }
  if (metadata.employmentType) job.type = metadata.employmentType.value;
  if (metadata.sourceUrl) job.source = { url: metadata.sourceUrl.value };
  if (metadata.location) job.location = metadata.location.value;
  const requirements = { required: [], preferred: [], competencies: [] };
  const responsibilities = [];
  const alternativeRequirements = [];
  extraction.items.forEach((item, index) => {
    const path = `/items/${index}`;
    if (item.type === "alternative") {
      let semanticValid = true;
      let semanticError;
      try { validateAlternativeSemantics({ ...item, context: item.evidence.quote }); } catch (error) {
        semanticValid = false;
        semanticError = error;
      }
      if (!semanticValid) {
        // A model may over-group a list as an alternative. If the source does
        // not contain a choice signal, discard the grouping conservatively;
        // it must never become mandatory AND requirements.
        const evidence = item.evidence.quote;
        const hasChoice = /\b(?:or|ou|either|one of|at least one|one or more|and\/or|equivalent experience)\b/iu.test(evidence)
          && !/\b(?:organization|company)\s+(?:or|ou)\s+(?:organization|company)\b/iu.test(evidence);
        if (!hasChoice) return;
        errors.push(issue("invalid_alternative", path, semanticError.message, { values: item.values, classification: item.classification, kind: item.kind }));
      } else if (!["required", "preferred"].includes(item.classification) || item.kind === "responsibility") {
        errors.push(issue("unsupported_alternative", path, "Alternative classification cannot be represented safely."));
      } else {
        alternativeRequirements.push({ operator: "anyOf", classification: item.classification,
          kind: item.kind, values: item.values, context: item.evidence.quote });
      }
    } else if (/\b(?:or|ou)\b/iu.test(item.value)
      && !/\b(?:or|ou)\s+higher\b/iu.test(item.value)
      && !/\b(?:organization|company)\s+(?:or|ou)\s+(?:organization|company)\b/iu.test(item.value)
      && ["skill", "requirement", "competency"].includes(item.kind)) {
      warnings.push(issue("unstructured_alternative", path, "Possible OR expression was omitted because its any-of semantics are not explicit in the intermediate output.", { value: item.value, classification: item.classification }));
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
  if (alternativeRequirements.length) job.alternativeRequirements = alternativeRequirements;
  if (responsibilities.length) job.responsibilities = responsibilities;
  if (errors.length) return { valid: false, job: null, errors, warnings };
  if (!validateJob(job)) return { valid: false, job: null, errors: [issue("final_schema", "/", "Mapped job failed final schema validation.", { details: validateJob.errors })], warnings };
  return { valid: true, job, errors: [], warnings };
}
