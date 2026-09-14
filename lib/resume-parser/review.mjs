export function reviewIssue(code, message, sourceText = "", extras = {}) {
  return { code, message, sourceText, severity: "warning", requiresHumanReview: true, ...extras };
}

export function parserStatus({ valid, issues }) {
  if (!valid) return "failed";
  return issues.length ? "review_required" : "ready";
}
