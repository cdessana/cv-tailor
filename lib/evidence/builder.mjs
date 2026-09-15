import { createHash, randomUUID } from "node:crypto";
import { validateResume } from "../resume-parser/validate.mjs";
import { EVIDENCE_BUILDER_VERSION, REVIEW_STATES, SOURCE_TYPES, assertEvidenceCandidate } from "./schema.mjs";
import { normalizeEvidenceClaim, normalizeSafeTerminology } from "./normalize.mjs";
import { validateSupportingSources } from "./source-contract.mjs";

const now = () => new Date().toISOString();

export class EvidenceBuilderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function stableId(prefix, ...parts) {
  const value = parts.map((part) => String(part ?? "").trim().toLowerCase()).join("\u001f");
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function normalized(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}+#.]+/gu, " ").replace(/\s+/g, " ").trim();
}

function phraseIn(text, phrase) {
  const haystack = normalized(normalizeSafeTerminology(text));
  const needle = normalized(normalizeSafeTerminology(phrase));
  return Boolean(needle) && new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$|[.,;:])`, "u").test(haystack);
}

function periodFor(work) {
  return [work.startDate, work.endDate ?? "Present"].filter(Boolean).join(" — ") || "Unknown";
}

function source(type, reference, extra = {}) {
  if (!SOURCE_TYPES.has(type)) throw new EvidenceBuilderError("EVIDENCE_SOURCE_INVALID", `Unsupported source type: ${type}`);
  return { type, reference, ...extra };
}

function normalizedClaim(value) {
  return normalizeEvidenceClaim(value);
}

export function createEvidenceClaim({ id, contextId, claim, claimSource, skills = [], reviewStatus = "pending", createdAt }) {
  const text = String(claim ?? "").trim();
  if (!id || !contextId || !text || !claimSource || !createdAt) {
    throw new EvidenceBuilderError("EVIDENCE_CLAIM_INVALID", "A claim requires an ID, context, non-empty text, source, and timestamp.");
  }
  return {
    id,
    contextId,
    claim: text,
    originalClaim: text,
    normalizedClaim: normalizedClaim(text),
    skills: [...new Set((Array.isArray(skills) ? skills : []).map((skill) => normalizeSafeTerminology(skill)).filter(Boolean))],
    source: claimSource,
    sources: [claimSource],
    reviewStatus,
    createdAt,
    updatedAt: createdAt,
  };
}

function sourceClaims(supportingSources, contexts, claims, issues, questions, createdAt) {
  for (const supportingSource of supportingSources) {
    if (supportingSource.claims === undefined) continue;
    if (!Array.isArray(supportingSource.claims)) throw new EvidenceBuilderError("EVIDENCE_SOURCE_CLAIMS_INVALID", "Supporting source claims must be an array.");
    for (const [index, input] of supportingSource.claims.entries()) {
      if (!input || typeof input !== "object" || !input.contextId || typeof input.claim !== "string" || !input.claim.trim()) {
        throw new EvidenceBuilderError("EVIDENCE_SOURCE_CLAIM_INVALID", "Each supporting claim needs a known contextId and non-empty claim text.", { source: supportingSource.reference, index });
      }
      const context = contexts.find((item) => item.id === input.contextId);
      if (!context) throw new EvidenceBuilderError("EVIDENCE_SOURCE_CONTEXT_UNKNOWN", "Supporting claims must reference an existing resume context.", { source: supportingSource.reference, contextId: input.contextId });
      const claimText = input.claim.trim();
      const claimSource = source(supportingSource.type, input.reference || `${supportingSource.reference}#claim-${index + 1}`);
      const existing = claims.find((claim) => claim.contextId === context.id && normalized(normalizedClaim(claim.originalClaim)) === normalized(normalizedClaim(claimText)));
      if (existing) {
        existing.sources = [...(existing.sources || [existing.source]), claimSource];
        continue;
      }
      const conflicting = claims.find((claim) => claim.contextId === context.id && Array.isArray(input.conflictsWith) && input.conflictsWith.some((value) => value === claim.id || normalized(normalizedClaim(value)) === normalized(normalizedClaim(claim.originalClaim))));
      const claim = createEvidenceClaim({
        id: stableId("claim", context.id, claimSource.reference, claimText),
        contextId: context.id,
        claim: claimText,
        claimSource,
        skills: Array.isArray(input.skills) ? input.skills : [],
        reviewStatus: conflicting ? "conflict" : "pending",
        createdAt,
      });
      claims.push(claim);
      addAmbiguity({ contextId: context.id, claim: claimText, claimSource, issues, questions, createdAt });
      if (conflicting) {
        issues.push({
          id: stableId("conflict", context.id, conflicting.id, claim.id), type: "source_claim_conflict", contextId: context.id,
          claimIds: [conflicting.id, claim.id], values: [conflicting.originalClaim, claim.originalClaim], sources: [...(conflicting.sources || [conflicting.source]), claimSource],
          question: "These sources disagree. Choose the statement you can confirm directly.", resolved: false, createdAt,
        });
      }
    }
  }
}

function resumeSkills(resume) {
  return (resume.skills ?? []).flatMap((group) => (group.keywords ?? []).map((name) => ({
    name: normalizeSafeTerminology(name),
    level: group.level ?? null,
    group: group.name ?? null,
  })));
}

function buildQuestions(context, facts) {
  const text = normalized(facts.join(" "));
  const base = [["dates", "Do the dates shown for this role look correct? If not, provide the dates you can confirm; if you do not remember, say so."]];
  const gaps = [
    [context.type !== "project" && !/(project|product|platform|application|portal|system)/i.test(text), "projects", "What project or product context best describes this role? You may answer 'I don't remember'."],
    [facts.length === 0 || !/(built|developed|designed|implemented|maintained|created|led|worked)/i.test(text), "delivery", "What did you personally build, change, or maintain in this role? Please describe only work you directly remember."],
    [!/(\d|percent|%|reduc|increas|improv|adopted|converted|supported)/i.test(text), "outcomes", "Were any outcomes measured? If you do not know the number, leave it unknown rather than estimating."],
    [!/(architect|architecture|service|api|backend|frontend|domain)/i.test(text), "architecture", "How were the systems or services organized and deployed? Describe only what you directly remember."],
    [!/(test|coverage|quality|ci\/cd|continuous integration|pipeline)/i.test(text), "quality", "What testing or delivery-quality practices did you personally use? You may answer 'I don't remember'."],
    [!/(cloud|database|sql|postgres|mysql|mongo|data)/i.test(text), "platforms", "Which cloud, data platform, or database technology did you use directly, if any? Do not guess."],
    [!/(lead|mentor|coach|team|stakeholder)/i.test(text), "leadership", "Did you coordinate, mentor, or make technical decisions with others? Describe the scope you can confirm."],
  ];
  for (const [needed, key, prompt] of gaps) if (needed) base.push([key, prompt]);
  if (facts.length === 0) base.push(["responsibilities", "What responsibilities can you confirm for this role? You may answer 'I don't remember'."]);
  return base.map(([key, prompt]) => ({
    id: stableId("question", context.id, key), contextId: context.id, key, prompt,
    allowUnknown: true, answered: false, createdAt: context.createdAt,
  }));
}

function ambiguityFor(claim) {
  const text = normalized(claim);
  const patterns = [
    [/\bmessaging systems?\b|\bmessage brokers?\b/, "Which messaging technology did you use directly? Name it only if you can confirm it."],
    [/\bcloud (?:platforms?|services?)\b|\bcloud-native\b/, "Which cloud platform or service can you confirm using directly?"],
    [/\bdatabase systems?\b|\bdata stores?\b/, "Which database or data store did you use directly?"],
  ];
  const match = patterns.find(([pattern]) => pattern.test(text));
  return match ? { key: "clarification", prompt: match[1] } : null;
}

function addAmbiguity({ contextId, claim, claimSource, issues, questions, createdAt }) {
  const ambiguity = ambiguityFor(claim);
  if (!ambiguity) return;
  const issueId = stableId("ambiguity", contextId, claimSource.reference, claim);
  if (!issues.some((issue) => issue.id === issueId)) {
    issues.push({ id: issueId, type: "ambiguous_technology", contextId, values: [claim.trim()], sources: [claimSource], question: ambiguity.prompt, resolved: false, createdAt });
  }
  const questionId = stableId("question", contextId, claimSource.reference, ambiguity.key);
  if (!questions.some((question) => question.id === questionId)) {
    questions.push({ id: questionId, contextId, key: ambiguity.key, prompt: ambiguity.prompt, allowUnknown: true, answered: false, createdAt });
  }
}

function addClaims({ context, facts, sourcePrefix, summaryField, hasSummary, skills, claims, issues, questions, createdAt }) {
  for (const [factIndex, fact] of facts.entries()) {
    const reference = `${sourcePrefix}${factIndex === 0 && hasSummary ? `.${summaryField}` : `.highlights[${factIndex - (hasSummary ? 1 : 0)}]`}`;
    const explicitSkills = skills.filter((skill) => phraseIn(fact, skill.name));
    const claimSource = source("json_resume", reference);
    claims.push(createEvidenceClaim({
      id: stableId("claim", context.id, reference, fact), contextId: context.id, claim: fact,
      claimSource, skills: explicitSkills.map((skill) => skill.name), createdAt,
    }));
    addAmbiguity({ contextId: context.id, claim: fact, claimSource, issues, questions, createdAt });
  }
}

export function createCandidate(resume, { sourceReference = "data/resumes/base.json", supportingSources = [] } = {}) {
  const validation = validateResume(resume);
  if (!validation.valid) throw new EvidenceBuilderError("EVIDENCE_RESUME_INVALID", "Structured resume does not satisfy the JSON Resume validation contract.", { errors: validation.errors });
  try { validateSupportingSources(supportingSources); }
  catch (error) { throw new EvidenceBuilderError(error.code || "EVIDENCE_SOURCE_INVALID", error.message, error.details); }

  const createdAt = now();
  const skills = resumeSkills(resume);
  const contexts = [];
  const claims = [];
  const questions = [];
  const issues = [];
  for (const [index, work] of (resume.work ?? []).entries()) {
    if (!work?.name || !work?.position) continue;
    const period = periodFor(work);
    const context = {
      id: stableId("context", work.name, work.position, work.startDate, work.endDate),
      company: work.name, position: work.position, period, type: "professional",
      source: source("json_resume", `work[${index}]`), createdAt,
    };
    contexts.push(context);
    const facts = [work.summary, ...(work.highlights ?? [])].filter((fact) => typeof fact === "string" && fact.trim());
    addClaims({ context, facts, sourcePrefix: `work[${index}]`, summaryField: "summary", hasSummary: Boolean(work.summary?.trim()), skills, claims, issues, questions, createdAt });
    questions.push(...buildQuestions(context, facts));
  }

  for (const [index, project] of (resume.projects ?? []).entries()) {
    if (!project?.name) continue;
    const company = typeof project.entity === "string" && project.entity.trim() ? project.entity.trim() : "Unspecified project entity";
    const relatedRoles = contexts.filter((context) => context.type === "professional" && normalized(context.company) === normalized(company));
    const parent = relatedRoles.length === 1 ? relatedRoles[0] : null;
    const projectSource = source("json_resume", `projects[${index}]`);
    const context = {
      id: stableId("context", "project", company, project.name, project.startDate, project.endDate), company,
      position: parent?.position ?? (project.roles?.[0] || "Unspecified project role"), period: periodFor(project), type: "project",
      project: { name: project.name.trim(), entity: project.entity?.trim() || null, roles: Array.isArray(project.roles) ? project.roles : [], url: project.url || null },
      ...(parent ? { parentContextId: parent.id } : {}), source: projectSource, createdAt,
    };
    contexts.push(context);
    const facts = [project.description, ...(project.highlights ?? [])].filter((fact) => typeof fact === "string" && fact.trim());
    addClaims({ context, facts, sourcePrefix: `projects[${index}]`, summaryField: "description", hasSummary: Boolean(project.description?.trim()), skills, claims, issues, questions, createdAt });
    questions.push(...buildQuestions(context, facts));
  }

  // Repeated company/role entries with the same start date but different end dates
  // cannot be reconciled safely without a human decision.
  const repeated = new Map();
  for (const context of contexts) {
    const key = `${normalized(context.company)}\u001f${normalized(context.position)}\u001f${normalized(context.period.split(" — ")[0])}`;
    const group = repeated.get(key) ?? [];
    group.push(context);
    repeated.set(key, group);
  }
  for (const group of repeated.values()) {
    const periods = [...new Set(group.map((context) => context.period))];
    if (periods.length < 2) continue;
    const context = group[0];
    issues.push({ id: stableId("conflict", context.company, context.position, ...periods), type: "date_conflict", contextId: context.id, values: periods, sources: group.map((item) => item.source), resolved: false, createdAt });
  }
  sourceClaims(supportingSources, contexts, claims, issues, questions, createdAt);

  const candidate = {
    version: 2,
    builderVersion: EVIDENCE_BUILDER_VERSION,
    revision: 1,
    runId: randomUUID(),
    createdAt,
    updatedAt: createdAt,
    source: source("json_resume", sourceReference),
    supportingSources,
    contexts,
    claims,
    questionnaire: { questions, answers: [] },
    issues,
    reviewDecisions: [],
  };
  assertEvidenceCandidate(candidate);
  return { candidate, report: createReport(candidate) };
}

export function createReport(candidate) {
  const claims = candidate.claims ?? [];
  const issues = candidate.issues ?? [];
  const counts = Object.fromEntries([...REVIEW_STATES].map((status) => [status, claims.filter((claim) => claim.reviewStatus === status).length]));
  const unresolvedIssues = issues.filter((issue) => !issue.resolved);
  const conflictIssues = unresolvedIssues.filter((issue) => issue.type.endsWith("_conflict"));
  const claimIdsCoveredByConflictIssues = new Set(conflictIssues.flatMap((issue) => issue.claimIds ?? []));
  const untrackedConflictedClaims = claims.filter((claim) => claim.reviewStatus === "conflict" && !claimIdsCoveredByConflictIssues.has(claim.id));
  const ambiguities = unresolvedIssues.filter((issue) => issue.type.startsWith("ambiguous_")).length;
  const blocking = counts.pending + counts.conflict + unresolvedIssues.length;
  const claimReviews = claims.map((claim) => ({
    id: claim.id, contextId: claim.contextId, claim: claim.claim, reviewStatus: claim.reviewStatus,
    source: claim.source, sources: claim.sources || [claim.source],
    // A conflict is resolved by choosing its issue value and then explicitly
    // accepting or rejecting every affected claim.  The claim must therefore
    // remain actionable after the issue itself is resolved.
    allowedActions: ["pending", "conflict"].includes(claim.reviewStatus) ? ["approve", "reject"] : [],
  }));
  const issueReviews = issues.map((issue) => ({
    ...issue,
    allowedActions: issue.resolved ? [] : issue.type.endsWith("_conflict") ? ["resolve_conflict"] : ["clarify", "resolve_conflict"],
  }));
  const allowedActions = [...new Set([
    ...claimReviews.flatMap((claim) => claim.allowedActions),
    ...issueReviews.flatMap((issue) => issue.allowedActions),
    ...(blocking ? [] : ["promote"]),
  ])];
  return {
    version: 2,
    builderVersion: candidate.builderVersion,
    runId: candidate.runId,
    generatedAt: now(),
    status: blocking ? "review_required" : "ready_for_promotion",
    summary: {
      factsExtracted: claims.length, approved: counts.approved, pendingReview: counts.pending, rejected: counts.rejected,
      conflicts: conflictIssues.length + untrackedConflictedClaims.length,
      ambiguities, unresolvedIssues: unresolvedIssues.length,
    },
    claims: claimReviews,
    issues: issueReviews,
    allowedActions,
    promotionSafe: blocking === 0,
  };
}

function addQuestionnaireProjects(next, question, inputProjects, updatedAt) {
  if (!Array.isArray(inputProjects) || !inputProjects.length) {
    throw new EvidenceBuilderError("EVIDENCE_PROJECT_STRUCTURED_REQUIRED", "Project answers must include at least one named project.");
  }
  const parent = next.contexts.find((context) => context.id === question.contextId);
  if (!parent) throw new EvidenceBuilderError("EVIDENCE_CONTEXT_UNKNOWN", `Question '${question.id}' has no context.`);
  const projectAnswers = [];
  for (const [index, input] of inputProjects.entries()) {
    if (!input || typeof input !== "object" || typeof input.name !== "string" || !input.name.trim()) {
      throw new EvidenceBuilderError("EVIDENCE_PROJECT_INVALID", "Each project answer requires a non-empty name.", { questionId: question.id, index });
    }
    if (input.facts !== undefined && (!Array.isArray(input.facts) || input.facts.some((fact) => typeof fact !== "string" || !fact.trim()))) {
      throw new EvidenceBuilderError("EVIDENCE_PROJECT_FACTS_INVALID", "Project facts must be non-empty strings when provided.", { questionId: question.id, index });
    }
    if (input.skills !== undefined && (!Array.isArray(input.skills) || input.skills.some((skill) => typeof skill !== "string" || !skill.trim()))) {
      throw new EvidenceBuilderError("EVIDENCE_PROJECT_SKILLS_INVALID", "Project skills must be non-empty strings when provided.", { questionId: question.id, index });
    }
    const name = input.name.trim();
    const contextId = stableId("context", "questionnaire-project", parent.id, name);
    const projectSource = source("questionnaire", `${question.id}#project:${contextId}`);
    let context = next.contexts.find((item) => item.id === contextId);
    if (!context) {
      context = {
        id: contextId, company: parent.company, position: parent.position, period: parent.period, type: "project",
        parentContextId: parent.id, project: { name, entity: parent.company, roles: [parent.position], url: null }, source: projectSource, createdAt: updatedAt,
      };
      next.contexts.push(context);
    }
    const answerId = stableId("answer", question.id, "project", contextId);
    if (!next.questionnaire.answers.some((answer) => answer.id === answerId)) {
      next.questionnaire.answers.push({ id: answerId, questionId: question.id, contextId: parent.id, projectContextId: context.id, answer: name, source: projectSource, createdAt: updatedAt });
    }
    const skills = [...new Set((input.skills ?? []).map((skill) => normalizeSafeTerminology(skill)))];
    for (const [factIndex, fact] of (input.facts ?? []).entries()) {
      const claim = fact.trim();
      const claimId = stableId("claim", context.id, question.id, factIndex, claim);
      if (!next.claims.some((item) => item.id === claimId)) {
        const claimSource = source("questionnaire", `${projectSource.reference}#fact-${factIndex + 1}`);
        next.claims.push(createEvidenceClaim({ id: claimId, contextId: context.id, claim, claimSource, skills, createdAt: updatedAt }));
        addAmbiguity({ contextId: context.id, claim, claimSource, issues: next.issues, questions: next.questionnaire.questions, createdAt: updatedAt });
      }
    }
    projectAnswers.push(answerId);
  }
  question.answered = true;
  question.answerId = projectAnswers[0];
}

export function applyQuestionnaireAnswers(candidate, answers) {
  if (!Array.isArray(answers)) throw new EvidenceBuilderError("EVIDENCE_ANSWERS_INVALID", "Answers must be an array.");
  for (const [index, answer] of answers.entries()) {
    if (!answer || typeof answer !== "object" || typeof answer.questionId !== "string" || !answer.questionId.trim()) {
      throw new EvidenceBuilderError("EVIDENCE_ANSWER_INVALID", "Each answer requires a questionId.", { index });
    }
  }
  const next = structuredClone(candidate);
  const updatedAt = now();
  for (const answer of answers ?? []) {
    const question = next.questionnaire.questions.find((item) => item.id === answer.questionId);
    if (!question) throw new EvidenceBuilderError("EVIDENCE_QUESTION_UNKNOWN", `Question '${answer.questionId}' does not exist.`);
    if (question.key === "projects") {
      const projectInputs = answer.projects ?? (answer.project ? [answer.project] : null);
      if (projectInputs) {
        addQuestionnaireProjects(next, question, projectInputs, updatedAt);
        continue;
      }
      const unknown = String(answer.answer ?? "").trim();
      if (!/^(|unknown|i don.t remember|not sure|nao sei|não sei|nao lembro|não lembro)$/i.test(unknown)) {
        throw new EvidenceBuilderError("EVIDENCE_PROJECT_STRUCTURED_REQUIRED", "Provide project responses as structured project data instead of a role-level text claim.", { questionId: question.id });
      }
      const answerId = stableId("answer", question.id, "unknown");
      if (!next.questionnaire.answers.some((item) => item.id === answerId)) next.questionnaire.answers.push({ id: answerId, questionId: question.id, contextId: question.contextId, answer: "unknown", source: source("questionnaire", question.id), createdAt: updatedAt });
      question.answered = true;
      question.answerId = answerId;
      continue;
    }
    const text = String(answer.answer ?? "").trim();
    const answerId = stableId("answer", question.id, text);
    const previousAnswers = next.questionnaire.answers.filter((item) => item.questionId === question.id && item.answer !== "unknown" && item.answer !== text);
    if (previousAnswers.length > 0) {
      next.issues.push({ id: stableId("conflict", question.id, previousAnswers[0].answer, text), type: "answer_conflict", contextId: question.contextId, values: [previousAnswers[0].answer, text], sources: [previousAnswers[0].source, source("questionnaire", question.id)], resolved: false, createdAt: updatedAt });
    }
    if (!next.questionnaire.answers.some((item) => item.id === answerId)) {
      next.questionnaire.answers.push({ id: answerId, questionId: question.id, contextId: question.contextId, answer: text || "unknown", source: source("questionnaire", question.id), createdAt: updatedAt });
    }
    question.answered = true;
    question.answerId = answerId;
    if (!text || /^(unknown|i don.t remember|not sure|nao sei|não sei|nao lembro|não lembro)$/i.test(text)) continue;
    if (question.key === "dates") {
      const context = next.contexts.find((item) => item.id === question.contextId);
      if (context && normalized(text) !== normalized(context.period)) {
        next.issues.push({
          id: stableId("conflict", context.id, "dates", context.period, text), type: "date_conflict", contextId: context.id,
          values: [context.period, text], sources: [context.source, source("questionnaire", question.id)], resolved: false, createdAt: updatedAt,
        });
      }
      continue;
    }
    const claimId = stableId("claim", question.contextId, question.id, text);
    const claimSource = source("questionnaire", question.id);
    if (!next.claims.some((item) => item.id === claimId)) next.claims.push(createEvidenceClaim({ id: claimId, contextId: question.contextId, claim: text, claimSource, createdAt: updatedAt }));
    addAmbiguity({ contextId: question.contextId, claim: text, claimSource, issues: next.issues, questions: next.questionnaire.questions, createdAt: updatedAt });
  }
  next.updatedAt = updatedAt;
  assertEvidenceCandidate(next);
  return { candidate: next, report: createReport(next) };
}

export function applyReviewDecisions(candidate, decisions) {
  const next = structuredClone(candidate);
  const updatedAt = now();
  for (const decision of decisions ?? []) {
    if (decision.issueId) {
      const issue = next.issues.find((item) => item.id === decision.issueId);
      if (!issue) throw new EvidenceBuilderError("EVIDENCE_ISSUE_UNKNOWN", `Issue '${decision.issueId}' does not exist.`);
      if (decision.status !== "resolved") throw new EvidenceBuilderError("EVIDENCE_CONFLICT_INVALID", "Conflict decisions must resolve the issue explicitly.");
      const values = Array.isArray(decision.values) ? decision.values.map((value) => String(value).trim()).filter(Boolean) : [];
      if (values.length !== 1 || !(issue.values || []).some((value) => normalized(value) === normalized(values[0]))) {
        throw new EvidenceBuilderError("EVIDENCE_CONFLICT_VALUE_REQUIRED", "Choose exactly one value from the conflicting values before resolving the issue.", { values: issue.values || [] });
      }
      const decidedAt = decision.decidedAt ?? updatedAt;
      issue.resolved = true;
      issue.resolution = { values, note: String(decision.note ?? ""), decidedAt, actor: String(decision.actor ?? "user") };
      next.reviewDecisions.push({ id: stableId("review", issue.id, "resolved", values[0], decidedAt), issueId: issue.id, contextId: issue.contextId, status: "resolved", values, note: String(decision.note ?? ""), actor: String(decision.actor ?? "user"), decidedAt, sources: issue.sources });
      continue;
    }
    const claim = next.claims.find((item) => item.id === decision.claimId);
    if (!claim) throw new EvidenceBuilderError("EVIDENCE_CLAIM_UNKNOWN", `Claim '${decision.claimId}' does not exist.`);
    if (!REVIEW_STATES.has(decision.status)) throw new EvidenceBuilderError("EVIDENCE_REVIEW_INVALID", "Review status must be pending, approved, rejected, or conflict.");
    const decidedAt = decision.decidedAt ?? updatedAt;
    claim.reviewStatus = decision.status;
    claim.updatedAt = updatedAt;
    claim.reviewDecision = { id: stableId("review", claim.id, decision.status, decision.note, decidedAt), status: decision.status, note: String(decision.note ?? ""), actor: String(decision.actor ?? "user"), decidedAt };
    next.reviewDecisions.push({ id: claim.reviewDecision.id, claimId: claim.id, contextId: claim.contextId, status: decision.status, note: claim.reviewDecision.note, actor: claim.reviewDecision.actor, decidedAt, sources: claim.sources || [claim.source] });
  }
  next.updatedAt = updatedAt;
  assertEvidenceCandidate(next);
  return { candidate: next, report: createReport(next) };
}

export function promoteCandidate(candidate) {
  assertEvidenceCandidate(candidate);
  const report = createReport(candidate);
  if (!report.promotionSafe) throw new EvidenceBuilderError("EVIDENCE_PROMOTION_BLOCKED", "Candidate evidence has unresolved review items or conflicts.", { report });
  const experiences = candidate.contexts.map((context) => {
    const approved = candidate.claims.filter((claim) => claim.contextId === context.id && claim.reviewStatus === "approved");
    return { id: context.id, company: context.company, position: context.position, period: context.period, type: context.type, facts: approved.map((claim) => claim.claim), skills: [...new Set(approved.flatMap((claim) => claim.skills))], provenance: approved.map((claim) => ({ claimId: claim.id, source: claim.source, sources: claim.sources || [claim.source] })) };
  }).filter((experience) => experience.facts.length > 0);
  return { version: 2, skills: Object.fromEntries([...new Set(experiences.flatMap((experience) => experience.skills))].map((skill) => [skill, { level: "verified" }])), experiences };
}
