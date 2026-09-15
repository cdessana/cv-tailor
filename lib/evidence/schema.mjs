export const EVIDENCE_BUILDER_VERSION = "2.0.0";
export const SOURCE_TYPES = new Set(["json_resume", "linkedin", "github", "feedback", "questionnaire", "manual"]);
export const REVIEW_STATES = new Set(["pending", "approved", "rejected", "conflict"]);

export class EvidenceSchemaError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.code = "EVIDENCE_SCHEMA_INVALID";
    this.details = details;
  }
}

function fail(path, message) {
  throw new EvidenceSchemaError(`${path}: ${message}`, { path });
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
}

function nonEmpty(value, path) {
  if (typeof value !== "string" || !value.trim()) fail(path, "must be a non-empty string");
}

function timestamp(value, path) {
  nonEmpty(value, path);
  if (Number.isNaN(Date.parse(value))) fail(path, "must be an ISO-parseable timestamp");
}

function source(value, path) {
  object(value, path);
  if (!SOURCE_TYPES.has(value.type)) fail(`${path}.type`, "is not supported");
  nonEmpty(value.reference, `${path}.reference`);
}

function unique(items, field, path) {
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    nonEmpty(item?.[field], `${path}[${index}].${field}`);
    if (ids.has(item[field])) fail(`${path}[${index}].${field}`, "must be unique");
    ids.add(item[field]);
  }
  return ids;
}

export function assertEvidenceCandidate(candidate) {
  object(candidate, "candidate");
  if (candidate.version !== 2) fail("candidate.version", "must be 2");
  nonEmpty(candidate.builderVersion, "candidate.builderVersion");
  nonEmpty(candidate.runId, "candidate.runId");
  timestamp(candidate.createdAt, "candidate.createdAt");
  timestamp(candidate.updatedAt, "candidate.updatedAt");
  source(candidate.source, "candidate.source");
  if (!Array.isArray(candidate.supportingSources)) fail("candidate.supportingSources", "must be an array");
  candidate.supportingSources.forEach((item, index) => source(item, `candidate.supportingSources[${index}]`));
  if (!Array.isArray(candidate.contexts) || !Array.isArray(candidate.claims) || !Array.isArray(candidate.issues)) fail("candidate", "must include contexts, claims, and issues arrays");
  const contextIds = unique(candidate.contexts, "id", "candidate.contexts");
  candidate.contexts.forEach((context, index) => {
    object(context, `candidate.contexts[${index}]`);
    ["company", "position", "period", "type"].forEach((field) => nonEmpty(context[field], `candidate.contexts[${index}].${field}`));
    source(context.source, `candidate.contexts[${index}].source`);
    timestamp(context.createdAt, `candidate.contexts[${index}].createdAt`);
    if (context.parentContextId !== undefined && !contextIds.has(context.parentContextId)) fail(`candidate.contexts[${index}].parentContextId`, "must reference an existing context");
    if (context.project !== undefined) {
      object(context.project, `candidate.contexts[${index}].project`);
      nonEmpty(context.project.name, `candidate.contexts[${index}].project.name`);
    }
  });
  unique(candidate.claims, "id", "candidate.claims");
  candidate.claims.forEach((claim, index) => {
    object(claim, `candidate.claims[${index}]`);
    if (!contextIds.has(claim.contextId)) fail(`candidate.claims[${index}].contextId`, "must reference an existing context");
    ["claim", "originalClaim", "normalizedClaim"].forEach((field) => nonEmpty(claim[field], `candidate.claims[${index}].${field}`));
    if (!Array.isArray(claim.skills)) fail(`candidate.claims[${index}].skills`, "must be an array");
    source(claim.source, `candidate.claims[${index}].source`);
    if (claim.sources !== undefined) {
      if (!Array.isArray(claim.sources) || !claim.sources.length) fail(`candidate.claims[${index}].sources`, "must be a non-empty array when provided");
      claim.sources.forEach((item, sourceIndex) => source(item, `candidate.claims[${index}].sources[${sourceIndex}]`));
    }
    if (!REVIEW_STATES.has(claim.reviewStatus)) fail(`candidate.claims[${index}].reviewStatus`, "is not supported");
    timestamp(claim.createdAt, `candidate.claims[${index}].createdAt`);
    timestamp(claim.updatedAt, `candidate.claims[${index}].updatedAt`);
  });
  object(candidate.questionnaire, "candidate.questionnaire");
  if (!Array.isArray(candidate.questionnaire.questions) || !Array.isArray(candidate.questionnaire.answers)) fail("candidate.questionnaire", "must include questions and answers arrays");
  const questionIds = unique(candidate.questionnaire.questions, "id", "candidate.questionnaire.questions");
  candidate.questionnaire.questions.forEach((question, index) => {
    if (!contextIds.has(question.contextId)) fail(`candidate.questionnaire.questions[${index}].contextId`, "must reference an existing context");
    ["key", "prompt"].forEach((field) => nonEmpty(question[field], `candidate.questionnaire.questions[${index}].${field}`));
  });
  candidate.questionnaire.answers.forEach((answer, index) => {
    if (!questionIds.has(answer.questionId)) fail(`candidate.questionnaire.answers[${index}].questionId`, "must reference an existing question");
    if (!contextIds.has(answer.contextId)) fail(`candidate.questionnaire.answers[${index}].contextId`, "must reference an existing context");
    nonEmpty(answer.answer, `candidate.questionnaire.answers[${index}].answer`);
    source(answer.source, `candidate.questionnaire.answers[${index}].source`);
    if (answer.projectContextId !== undefined && !contextIds.has(answer.projectContextId)) fail(`candidate.questionnaire.answers[${index}].projectContextId`, "must reference an existing context");
    timestamp(answer.createdAt, `candidate.questionnaire.answers[${index}].createdAt`);
  });
  unique(candidate.issues, "id", "candidate.issues");
  candidate.issues.forEach((issue, index) => {
    if (!contextIds.has(issue.contextId)) fail(`candidate.issues[${index}].contextId`, "must reference an existing context");
    nonEmpty(issue.type, `candidate.issues[${index}].type`);
    if (!Array.isArray(issue.values) || !issue.values.length) fail(`candidate.issues[${index}].values`, "must have at least one value");
    if (!Array.isArray(issue.sources) || !issue.sources.length) fail(`candidate.issues[${index}].sources`, "must have at least one source");
    issue.sources.forEach((item, sourceIndex) => source(item, `candidate.issues[${index}].sources[${sourceIndex}]`));
    if (issue.claimIds !== undefined) {
      if (!Array.isArray(issue.claimIds) || !issue.claimIds.length) fail(`candidate.issues[${index}].claimIds`, "must be a non-empty array when provided");
      const claimIds = new Set(candidate.claims.map((claim) => claim.id));
      issue.claimIds.forEach((claimId, claimIndex) => {
        if (!claimIds.has(claimId)) fail(`candidate.issues[${index}].claimIds[${claimIndex}]`, "must reference an existing claim");
      });
    }
    timestamp(issue.createdAt, `candidate.issues[${index}].createdAt`);
  });
  if (!Array.isArray(candidate.reviewDecisions)) fail("candidate.reviewDecisions", "must be an array");
  unique(candidate.reviewDecisions, "id", "candidate.reviewDecisions");
  candidate.reviewDecisions.forEach((decision, index) => {
    nonEmpty(decision.actor, `candidate.reviewDecisions[${index}].actor`);
    timestamp(decision.decidedAt, `candidate.reviewDecisions[${index}].decidedAt`);
    if (!decision.claimId && !decision.issueId) fail(`candidate.reviewDecisions[${index}]`, "must reference a claim or issue");
  });
  return candidate;
}

export function assertEvidenceReport(report) {
  object(report, "report");
  if (report.version !== 2) fail("report.version", "must be 2");
  nonEmpty(report.builderVersion, "report.builderVersion");
  nonEmpty(report.runId, "report.runId");
  timestamp(report.generatedAt, "report.generatedAt");
  if (!["review_required", "ready_for_promotion"].includes(report.status)) fail("report.status", "is not supported");
  if (typeof report.promotionSafe !== "boolean") fail("report.promotionSafe", "must be boolean");
  if (!Array.isArray(report.claims) || !Array.isArray(report.issues) || !Array.isArray(report.allowedActions)) fail("report", "must include claim, issue, and action arrays");
  report.claims.forEach((claim, index) => {
    nonEmpty(claim.id, `report.claims[${index}].id`);
    nonEmpty(claim.contextId, `report.claims[${index}].contextId`);
    if (!REVIEW_STATES.has(claim.reviewStatus)) fail(`report.claims[${index}].reviewStatus`, "is not supported");
    source(claim.source, `report.claims[${index}].source`);
    if (!Array.isArray(claim.allowedActions)) fail(`report.claims[${index}].allowedActions`, "must be an array");
  });
  report.issues.forEach((issue, index) => {
    nonEmpty(issue.id, `report.issues[${index}].id`);
    if (!Array.isArray(issue.allowedActions)) fail(`report.issues[${index}].allowedActions`, "must be an array");
  });
  return report;
}
