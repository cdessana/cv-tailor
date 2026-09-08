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
  for (const [key, record] of Object.entries(metadata)) {
    const distinct = new Set((record.candidates ?? []).map(candidate => candidate.value.replace(/\s+/gu, " ").trim().toLocaleLowerCase()));
    if (distinct.size > 1) warnings.push(issue("ambiguous_metadata", `/metadata/${key}`,
      `Human validation required for ${key}. Selected "${record.value}"; other source-backed candidates remain.`,
      { requiresHumanValidation: true, selected: { value: record.value, evidence: record.evidence }, candidates: structuredClone(record.candidates) }));
  }
  for (const key of ["company", "title"]) {
    if (metadata[key]) {
      job[key] = metadata[key].value;
    } else {
      errors.push(issue("missing_metadata", `/metadata/${key}`, `Missing required metadata: ${key}.`));
    }
  }
  if (metadata.employmentType) job.type = metadata.employmentType.value;
  if (metadata.workArrangement) job.remote = metadata.workArrangement.value;
  if (metadata.sourceUrl) job.source = { url: metadata.sourceUrl.value };
  if (metadata.location) {
    job.location = metadata.location.value;
  }
  const requirements = { required: [], preferred: [], competencies: [] };
  const responsibilities = [];
  const alternativeRequirements = [];
  const requirementExamples = [];
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
        // Do not repair model groupings by truncating the source sentence.
        // Non-parenthetical examples also require a broader ordinary extraction.
        const illustrative = item.evidence.quote.match(/\b(?:like|such as|for example|como|por exemplo)\s+([^.!?;]+)/iu);
        if (illustrative && item.values.every(value => illustrative[1].toLocaleLowerCase().includes(value.toLocaleLowerCase()))) {
          throw new Error("Example technologies cannot replace the broader qualification. Extract the broader source-backed qualification as an ordinary item.");
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
    if (item.type === "item" && item.examples && ["skill", "requirement", "competency"].includes(item.kind)) {
      const classification = item.kind === "competency" ? "competencies" : item.classification;
      if (requirements[classification]?.includes(item.value)) {
        requirementExamples.push({ classification, requirement: item.value, values: item.examples.map(example => example.value) });
      }
    }
  });
  if (requirements.required.length || requirements.preferred.length || requirements.competencies.length) job.requirements = requirements;
  if (alternativeRequirements.length) job.alternativeRequirements = alternativeRequirements;
  if (responsibilities.length) job.responsibilities = responsibilities;
  if (requirementExamples.length) job.requirementExamples = requirementExamples;
  if (errors.length) return { valid: false, job: null, errors, warnings };
  if (!validateJob(job)) return { valid: false, job: null, errors: [issue("final_schema", "/", "Mapped job failed final schema validation.", { details: structuredClone(validateJob.errors) })], warnings };
  return { valid: true, job, errors: [], warnings };
}
