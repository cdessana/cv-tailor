import fs from "node:fs/promises";
import Ajv from "ajv";
import { assertExtraction } from "./extraction-contract.mjs";
import { isDescriptiveOr, validateAlternativeSemantics } from "../job-requirements/alternatives.mjs";

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
    if (metadata[key]) {
      job[key] = metadata[key].value;
      if (metadata[key].candidates?.length > 1) {
        warnings.push(issue("ambiguous_metadata", `/metadata/${key}`, `Multiple candidates found for ${key}: ${metadata[key].candidates.map(c => c.value).join(", ")}. Using "${metadata[key].value}".`, { candidates: metadata[key].candidates }));
      }
    } else {
      errors.push(issue("missing_metadata", `/metadata/${key}`, `Missing required metadata: ${key}.`));
    }
  }
  if (metadata.employmentType) job.type = metadata.employmentType.value;
  if (metadata.sourceUrl) job.source = { url: metadata.sourceUrl.value };
  if (metadata.location) {
    job.location = metadata.location.value;
    if (metadata.location.candidates?.length > 1) {
      warnings.push(issue("ambiguous_metadata", "/metadata/location", `Multiple candidates found for location: ${metadata.location.candidates.map(c => c.value).join(", ")}. Using "${metadata.location.value}".`, { candidates: metadata.location.candidates }));
    }
  }
  const requirements = { required: [], preferred: [], competencies: [] };
  const responsibilities = [];
  const alternativeRequirements = [];
  extraction.items.forEach((item, index) => {
    const path = `/items/${index}`;
    if (item.type === "alternative") {
      let semanticValid = true;
      let semanticError;
      try {
        // A parenthetical example list is not an exhaustive qualification choice.
        // Scope the check to the options, so unrelated examples elsewhere in the
        // evidence do not invalidate a genuine OR requirement.
        const examples = item.evidence.quote.matchAll(/\(\s*(?:such as\b|e\.g\.|for example\b|como\b|por exemplo\b)([^()]*)\)/giu);
        for (const [, example] of examples) {
          if (item.values.every(value => example.includes(value))) {
            throw new Error("Example technologies cannot replace the broader qualification. Extract the broader source-backed qualification as an ordinary item.");
          }
        }
        // Models sometimes emit an anyOf group for non-exhaustive "like"
        // examples. Preserve the broader source-backed qualification instead
        // of treating illustrative technologies as mutually exclusive.
        const illustrative = item.evidence.quote.match(/^(.*?)(?:\s+(?:like|such as|e\.g\.|for example|como|por exemplo)\b)/iu);
        if (illustrative && item.values.every(value => item.evidence.quote.toLocaleLowerCase().includes(value.toLocaleLowerCase()))) {
          if (!["required", "preferred"].includes(item.classification)) throw new Error("Illustrative qualification has unsupported classification.");
          // Strip trailing punctuation and connectors from the label
          const label = illustrative[1].replace(/[\s,;:|•\-*]+$/u, "").replace(/\s+(?:and|e)$/iu, "").trim();
          if (label) {
            requirements[item.classification].push(label);
            return;
          }
        }
        validateAlternativeSemantics({ ...item, context: item.evidence.quote });
      } catch (error) {
        semanticValid = false;
        semanticError = error;
      }
      if (!semanticValid) {
        errors.push(issue("invalid_alternative", path, semanticError.message, { values: item.values, classification: item.classification, kind: item.kind }));
      } else if (!["required", "preferred"].includes(item.classification) || item.kind === "responsibility") {
        errors.push(issue("unsupported_alternative", path, "Alternative classification cannot be represented safely."));
      } else {
        // A company-stack statement explicitly says the tools are non-mandatory;
        // it is context rather than a candidate requirement.
        if (/\b(?:our|the)\s+(?:main\s+)?stack\b[\s\S]*\b(?:over|rather than)\b[\s\S]*\b(?:specific|particular)\s+tool/iu.test(item.evidence.quote)) {
          warnings.push(issue("context_only_stack", path, "Company stack context was omitted because the source rejects tool-specific requirements.", { values: item.values }));
          return;
        }
        alternativeRequirements.push({ operator: "anyOf", classification: item.classification,
          kind: item.kind, values: item.values, context: item.evidence.quote });
      }
    } else if (/\b(?:or|ou)\b/iu.test(item.value.replace(/\b\d+(?:[.,]\d+)?\s+(?:or\s+more|ou\s+mais)\b/giu, ""))
      && !/\b(?:or|ou)\s+(?:higher|superior|equivalent|equivalente|else|demais)\b/iu.test(item.value)
      && !isDescriptiveOr(item.value)
      && !/\b(?:frameworks|tools|technologies|plataformas|ferramentas)\s+(?:like|such as|e\.g\.|including|como|tais como)\b/iu.test(item.value)
      && ["skill", "requirement", "competency"].includes(item.kind)) {
      errors.push(issue("unstructured_alternative", path, "Possible OR expression must be represented as a group or resolved conservatively.", { value: item.value, classification: item.classification }));
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
  if (!validateJob(job)) return { valid: false, job: null, errors: [issue("final_schema", "/", "Mapped job failed final schema validation.", { details: structuredClone(validateJob.errors) })], warnings };
  return { valid: true, job, errors: [], warnings };
}
