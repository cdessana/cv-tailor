import fs from "node:fs/promises";
import Ajv from "ajv";
import { assertExtraction } from "./extraction-contract.mjs";
import { validateItemSemantics } from "./validate-item-semantics.mjs";

const schema = JSON.parse(await fs.readFile(new URL("../../schemas/job.schema.json", import.meta.url), "utf8"));
const validateJob = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile(schema);

const issue = (code, path, message, details = {}) => ({ code, path, message, ...details });
const normalized = value => String(value).replace(/\s+/gu, " ").trim().toLocaleLowerCase();

// An ordinary prefix of an equivalent alternative's evidence carries no
// independent requirement. Keep the alternative because it retains the choice
// and all qualifiers; do not use semantic similarity to remove other overlaps.
function shadowedItemIndices(items) {
  const indices = new Set();
  items.forEach((item, index) => {
    if (item.type !== "item" || !["required", "preferred"].includes(item.classification)) return;
    const value = normalized(item.value);
    const quote = normalized(item.evidence.quote);
    if (items.some(other => other.type === "alternative"
      && other.classification === item.classification
      && normalized(other.evidence.quote) === quote
      && quote.startsWith(value)
      && other.values.some(option => quote.indexOf(normalized(option)) >= value.length))) {
      indices.add(index);
    }
  });
  return indices;
}

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
  const shadowed = shadowedItemIndices(extraction.items);
  extraction.items.forEach((item, index) => {
    const path = `/items/${index}`;
    if (shadowed.has(index)) {
      warnings.push(issue("shadowed_item", path,
        "A less-specific item was omitted because an equivalent alternative retains its complete evidence and choice.",
        { value: item.value, retainedBy: "alternative" }));
      return;
    }

    // The intermediate representation has already established item boundaries,
    // evidence, and optional examples. Mapping is a compatibility projection:
    // it must not reinterpret source prose or remove qualifying details.
    const itemValue = item.value;
    const allExamples = item.examples?.map(example => example.value) ?? [];
    const validationItem = item;

    const semanticErrors = validateItemSemantics(validationItem, { metadata });
    if (semanticErrors.length) {
      errors.push(...semanticErrors.map(error => ({ ...error, path: path + error.path })));
      return;
    }

    if (item.type === "alternative") {
      alternativeRequirements.push({
        operator: "anyOf", classification: item.classification,
        kind: item.kind, values: [...item.values], context: item.evidence.quote
      });
    } else if (item.kind === "responsibility") {
      responsibilities.push(itemValue);
    } else if (item.kind === "ambiguous" || item.classification === "ambiguous") {
      errors.push(issue("ambiguous_item", path, "Ambiguous items cannot be safely projected into the legacy job format.", { value: itemValue }));
    } else if (item.kind === "competency") {
      requirements.competencies.push(itemValue);
    } else if (item.classification === "required") {
      requirements.required.push(itemValue);
    } else if (item.classification === "preferred") {
      requirements.preferred.push(itemValue);
    } else {
      errors.push(issue("unsupported_classification", path, "Item classification has no legacy mapping.", { value: itemValue }));
    }

    if (item.type === "item" && allExamples.length > 0 && ["skill", "requirement", "competency"].includes(item.kind)) {
      const classification = item.kind === "competency" ? "competencies" : item.classification;
      if (requirements[classification]?.includes(itemValue)) {
        requirementExamples.push({
          classification,
          requirement: itemValue,
          values: [...new Set(allExamples.map(v => v.trim()).filter(v => v.length > 1))]
        });
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
