import { createHash } from "node:crypto";
import { validateResume } from "../resume-parser/validate.mjs";

const SOURCE_TYPES = new Set(["json_resume", "linkedin", "github", "feedback", "questionnaire", "manual"]);
const REVIEW_STATES = new Set(["pending", "approved", "rejected", "conflict"]);

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
  const haystack = normalized(text);
  const needle = normalized(phrase);
  return Boolean(needle) && new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$|[.,;:])`, "u").test(haystack);
}

function periodFor(work) {
  return [work.startDate, work.endDate ?? "Present"].filter(Boolean).join(" — ") || "Unknown";
}

function source(type, reference, extra = {}) {
  if (!SOURCE_TYPES.has(type)) throw new EvidenceBuilderError("EVIDENCE_SOURCE_INVALID", `Unsupported source type: ${type}`);
  return { type, reference, ...extra };
}

function resumeSkills(resume) {
  return (resume.skills ?? []).flatMap((group) => (group.keywords ?? []).map((name) => ({
    name,
    level: group.level ?? null,
    group: group.name ?? null,
  })));
}

function buildQuestions(context, hasFacts) {
  const base = [
    ["dates", "Do the dates shown for this role look correct? If not, provide the dates you can confirm; if you do not remember, say so."],
    ["projects", "What project or product context best describes this role? You may answer 'I don't remember'."],
    ["delivery", "What did you personally build, change, or maintain in this role? Please describe only work you directly remember."],
    ["outcomes", "Were any outcomes measured? If you do not know the number, leave it unknown rather than estimating."],
  ];
  if (!hasFacts) base.unshift(["responsibilities", "What responsibilities can you confirm for this role? You may answer 'I don't remember'."]);
  return base.map(([key, prompt]) => ({
    id: stableId("question", context.id, key), contextId: context.id, key, prompt,
    allowUnknown: true,
  }));
}

export function createCandidate(resume, { sourceReference = "data/resumes/base.json", supportingSources = [] } = {}) {
  const validation = validateResume(resume);
  if (!validation.valid) throw new EvidenceBuilderError("EVIDENCE_RESUME_INVALID", "Structured resume does not satisfy the JSON Resume validation contract.", { errors: validation.errors });
  if (!Array.isArray(supportingSources) || supportingSources.some((item) => !item || !SOURCE_TYPES.has(item.type) || !item.reference)) {
    throw new EvidenceBuilderError("EVIDENCE_SOURCE_INVALID", "Supporting sources require a supported type and reference.");
  }

  const skills = resumeSkills(resume);
  const contexts = [];
  const claims = [];
  const questions = [];
  for (const [index, work] of (resume.work ?? []).entries()) {
    if (!work?.name || !work?.position) continue;
    const period = periodFor(work);
    const context = {
      id: stableId("context", work.name, work.position, work.startDate, work.endDate),
      company: work.name, position: work.position, period, type: "professional",
      source: source("json_resume", `work[${index}]`),
    };
    contexts.push(context);
    const facts = [work.summary, ...(work.highlights ?? [])].filter((fact) => typeof fact === "string" && fact.trim());
    for (const [factIndex, fact] of facts.entries()) {
      const reference = work.summary && factIndex === 0 ? `work[${index}].summary` : `work[${index}].highlights[${work.summary ? factIndex - 1 : factIndex}]`;
      const explicitSkills = skills.filter((skill) => phraseIn(fact, skill.name));
      claims.push({
        id: stableId("claim", context.id, reference, fact), contextId: context.id, claim: fact.trim(),
        skills: explicitSkills.map((skill) => skill.name), source: source("json_resume", reference), reviewStatus: "pending",
      });
    }
    questions.push(...buildQuestions(context, facts.length > 0));
  }

  const candidate = {
    version: 1,
    source: source("json_resume", sourceReference),
    supportingSources,
    contexts,
    claims,
    questionnaire: { questions, answers: [] },
    issues: [],
  };
  return { candidate, report: createReport(candidate) };
}

export function createReport(candidate) {
  const claims = candidate.claims ?? [];
  const issues = candidate.issues ?? [];
  const counts = Object.fromEntries([...REVIEW_STATES].map((status) => [status, claims.filter((claim) => claim.reviewStatus === status).length]));
  const blocking = counts.pending + counts.conflict + issues.filter((issue) => !issue.resolved).length;
  return {
    version: 1,
    status: blocking ? "review_required" : "ready_for_promotion",
    summary: { factsExtracted: claims.length, approved: counts.approved, pendingReview: counts.pending, rejected: counts.rejected, conflicts: counts.conflict + issues.filter((issue) => issue.type === "date_conflict" && !issue.resolved).length },
    issues,
    allowedActions: blocking ? ["approve", "reject", "resolve_conflict"] : ["promote"],
    promotionSafe: blocking === 0,
  };
}

export function applyQuestionnaireAnswers(candidate, answers) {
  const next = structuredClone(candidate);
  for (const answer of answers ?? []) {
    const question = next.questionnaire.questions.find((item) => item.id === answer.questionId);
    if (!question) throw new EvidenceBuilderError("EVIDENCE_QUESTION_UNKNOWN", `Question '${answer.questionId}' does not exist.`);
    const text = String(answer.answer ?? "").trim();
    const answerId = stableId("answer", question.id, text);
    if (!next.questionnaire.answers.some((item) => item.id === answerId)) {
      next.questionnaire.answers.push({ id: answerId, questionId: question.id, contextId: question.contextId, answer: text || "unknown", source: source("questionnaire", question.id) });
    }
    if (!text || /^(unknown|i don.t remember|not sure|nao sei|não sei|nao lembro|não lembro)$/i.test(text)) continue;
    if (question.key === "dates") {
      const context = next.contexts.find((item) => item.id === question.contextId);
      if (context && normalized(text) !== normalized(context.period)) {
        next.issues.push({
          id: stableId("conflict", context.id, "dates", context.period, text), type: "date_conflict", contextId: context.id,
          values: [context.period, text], sources: [context.source, source("questionnaire", question.id)], resolved: false,
        });
      }
      continue;
    }
    const claimId = stableId("claim", question.contextId, question.id, text);
    if (!next.claims.some((item) => item.id === claimId)) next.claims.push({ id: claimId, contextId: question.contextId, claim: text, skills: [], source: source("questionnaire", question.id), reviewStatus: "pending" });
  }
  return { candidate: next, report: createReport(next) };
}

export function applyReviewDecisions(candidate, decisions) {
  const next = structuredClone(candidate);
  for (const decision of decisions ?? []) {
    if (decision.issueId) {
      const issue = next.issues.find((item) => item.id === decision.issueId);
      if (!issue) throw new EvidenceBuilderError("EVIDENCE_ISSUE_UNKNOWN", `Issue '${decision.issueId}' does not exist.`);
      if (decision.status !== "resolved") throw new EvidenceBuilderError("EVIDENCE_CONFLICT_INVALID", "Conflict decisions must resolve the issue explicitly.");
      issue.resolved = true;
      issue.resolution = { values: decision.values ?? [], note: String(decision.note ?? ""), decidedAt: decision.decidedAt ?? new Date().toISOString() };
      continue;
    }
    const claim = next.claims.find((item) => item.id === decision.claimId);
    if (!claim) throw new EvidenceBuilderError("EVIDENCE_CLAIM_UNKNOWN", `Claim '${decision.claimId}' does not exist.`);
    if (!REVIEW_STATES.has(decision.status)) throw new EvidenceBuilderError("EVIDENCE_REVIEW_INVALID", "Review status must be pending, approved, rejected, or conflict.");
    claim.reviewStatus = decision.status;
    claim.reviewDecision = { id: stableId("review", claim.id, decision.status, decision.note), status: decision.status, note: String(decision.note ?? ""), decidedAt: decision.decidedAt ?? new Date().toISOString() };
  }
  return { candidate: next, report: createReport(next) };
}

export function promoteCandidate(candidate) {
  const report = createReport(candidate);
  if (!report.promotionSafe) throw new EvidenceBuilderError("EVIDENCE_PROMOTION_BLOCKED", "Candidate evidence has unresolved review items or conflicts.", { report });
  const experiences = candidate.contexts.map((context) => {
    const approved = candidate.claims.filter((claim) => claim.contextId === context.id && claim.reviewStatus === "approved");
    return { id: context.id, company: context.company, position: context.position, period: context.period, type: context.type, facts: approved.map((claim) => claim.claim), skills: [...new Set(approved.flatMap((claim) => claim.skills))], provenance: approved.map((claim) => ({ claimId: claim.id, source: claim.source })) };
  }).filter((experience) => experience.facts.length > 0);
  return { version: 2, skills: Object.fromEntries([...new Set(experiences.flatMap((experience) => experience.skills))].map((skill) => [skill, { level: "verified" }])), experiences };
}
