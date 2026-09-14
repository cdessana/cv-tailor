import { findConflicts } from "./conflicts.mjs";
import { validateResume } from "./validate.mjs";

export function assembleResume(resume, { issues = [], provenance = [] } = {}) {
  const validation = validateResume(resume);
  const validationIssues = validation.errors.map((error) => ({ code: "schema_validation", ...error, severity: "warning", requiresHumanReview: true }));
  return { resume, provenance, issues: [...issues, ...findConflicts(resume), ...validationIssues], valid: validation.valid };
}
