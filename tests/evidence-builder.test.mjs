import assert from "node:assert/strict";
import test from "node:test";
import { applyQuestionnaireAnswers, applyReviewDecisions, createCandidate, EvidenceBuilderError, promoteCandidate } from "../lib/evidence/builder.mjs";

const resume = {
  basics: { name: "Synthetic Candidate", email: "candidate@example.com" },
  skills: [{ name: "Backend", keywords: ["Node.js", "PostgreSQL", "gRPC", "MongoDB"] }],
  work: [
    { name: "Example", position: "Engineer", startDate: "2021", endDate: "2023", highlights: ["Built REST APIs using Node.js and PostgreSQL.", "Improved API performance."] },
    { name: "Example", position: "Engineer", startDate: "2023", highlights: ["Built gRPC services using .NET."] },
  ],
};

test("builds pending, contextual claims from explicit resume wording only", () => {
  const { candidate, report } = createCandidate(resume);
  assert.equal(report.status, "review_required");
  assert.equal(candidate.claims.length, 3);
  assert.deepEqual(candidate.claims[0].skills, ["Node.js", "PostgreSQL"]);
  assert.equal(candidate.claims[1].claim, "Improved API performance.");
  assert.equal(candidate.claims.flatMap((claim) => claim.skills).includes("Kafka"), false);
  assert.equal(candidate.claims[0].contextId === candidate.claims[2].contextId, false);
  assert.equal(candidate.claims[0].source.reference, "work[0].highlights[0]");
});

test("questionnaire date conflicts block promotion and unknown answers add no claim", () => {
  const { candidate } = createCandidate(resume);
  const dates = candidate.questionnaire.questions.find((question) => question.key === "dates" && question.contextId === candidate.contexts[0].id);
  const project = candidate.questionnaire.questions.find((question) => question.key === "projects");
  const result = applyQuestionnaireAnswers(candidate, [
    { questionId: dates.id, answer: "2022 — 2023" },
    { questionId: project.id, answer: "I don't remember" },
  ]);
  assert.equal(result.report.promotionSafe, false);
  assert.equal(result.report.issues[0].type, "date_conflict");
  assert.equal(result.candidate.claims.length, candidate.claims.length);
  assert.throws(() => promoteCandidate(result.candidate), (error) => error instanceof EvidenceBuilderError && error.code === "EVIDENCE_PROMOTION_BLOCKED");
});

test("only explicitly approved claims are promoted to canonical evidence", () => {
  const { candidate } = createCandidate(resume);
  const reviewed = applyReviewDecisions(candidate, candidate.claims.map((claim, index) => ({ claimId: claim.id, status: index === 0 ? "approved" : "rejected" })));
  const evidence = promoteCandidate(reviewed.candidate);
  assert.equal(evidence.experiences.length, 1);
  assert.deepEqual(evidence.experiences[0].facts, ["Built REST APIs using Node.js and PostgreSQL."]);
  assert.deepEqual(evidence.experiences[0].skills, ["Node.js", "PostgreSQL"]);
});

test("rejects structured resumes that fail the existing validation contract", () => {
  assert.throws(() => createCandidate({ basics: { email: "not-an-email" } }), (error) => error.code === "EVIDENCE_RESUME_INVALID");
});

test("surfaces ambiguous technology wording without inventing a vendor", () => {
  const ambiguous = structuredClone(resume);
  ambiguous.work = [{ name: "Example", position: "Engineer", highlights: ["Worked with messaging systems."] }];
  const { candidate, report } = createCandidate(ambiguous);
  assert.equal(candidate.claims.some((claim) => claim.claim.includes("Kafka")), false);
  assert.equal(report.issues[0].type, "ambiguous_technology");
  assert.equal(report.promotionSafe, false);
});

test("surfaces contradictory questionnaire answers as an unresolved conflict", () => {
  const { candidate } = createCandidate(resume);
  const question = candidate.questionnaire.questions.find((item) => item.key === "projects");
  const first = applyQuestionnaireAnswers(candidate, [{ questionId: question.id, answer: "Billing platform" }]);
  const second = applyQuestionnaireAnswers(first.candidate, [{ questionId: question.id, answer: "Analytics platform" }]);
  assert.equal(second.candidate.issues.some((issue) => issue.type === "answer_conflict"), true);
  assert.equal(second.report.promotionSafe, false);
});
