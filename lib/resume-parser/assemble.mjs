import { findConflicts } from "./conflicts.mjs";
import { validateResume } from "./validate.mjs";
import { provenanceForEntry } from "./extracted-entry.mjs";

export function assembleResume(resume, { issues = [], provenance = [] } = {}) {
  const validation = validateResume(resume);
  const validationIssues = validation.errors.map((error) => ({ code: "schema_validation", ...error, severity: "warning", requiresHumanReview: true }));
  return { resume, provenance, issues: [...issues, ...findConflicts(resume), ...validationIssues], valid: validation.valid };
}

export function assembleExtractedEntries(entries) {
  return entries.reduce((result, entry, index) => ({
    values: [...result.values, entry.value],
    provenance: [...result.provenance, ...provenanceForEntry(`/${index}`, entry.sources)],
  }), { values: [], provenance: [] });
}
