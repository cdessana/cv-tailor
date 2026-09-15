import assert from "node:assert/strict";
import test from "node:test";
import { applyQuestionnaireAnswers, applyReviewDecisions, createCandidate, promoteCandidate } from "../lib/evidence/builder.mjs";

const resume = {
  basics: { name: "Acceptance Candidate", email: "candidate@example.com" },
  skills: [{ name: "Backend", keywords: ["Node.js", "PostgreSQL", "gRPC", "MongoDB"] }],
  work: [{ name: "Example", position: "Engineer", startDate: "2021", highlights: ["Improved API performance."] }],
  projects: [
    { name: "Project A", entity: "Example", description: "Built Node.js APIs with MongoDB." },
    { name: "Project B", entity: "Example", description: "Built gRPC services with PostgreSQL." }
  ],
};

test("acceptance: candidate evidence stays contextual, pending, and exact", () => {
  const { candidate, report } = createCandidate(resume);
  const roleClaim = candidate.claims.find((claim) => claim.claim === "Improved API performance.");
  assert.equal(roleClaim.claim.includes("%"), false);
  assert.equal(roleClaim.skills.includes("Kafka"), false);
  const [projectA, projectB] = candidate.contexts.filter((context) => context.type === "project");
  assert.deepEqual(candidate.claims.find((claim) => claim.contextId === projectA.id).skills, ["Node.js", "MongoDB"]);
  assert.deepEqual(candidate.claims.find((claim) => claim.contextId === projectB.id).skills, ["PostgreSQL", "gRPC"]);
  assert.equal(report.promotionSafe, false);
  assert.throws(() => promoteCandidate(candidate));
});

test("acceptance: questionnaire facts need review and only approved evidence promotes", () => {
  const { candidate } = createCandidate(resume);
  const quality = candidate.questionnaire.questions.find((question) => question.key === "quality");
  const answered = applyQuestionnaireAnswers(candidate, [{ questionId: quality.id, answer: "Wrote unit tests." }]);
  const reviewed = applyReviewDecisions(answered.candidate, answered.candidate.claims.map((claim) => ({ claimId: claim.id, status: claim.source.type === "questionnaire" ? "rejected" : "approved" })));
  const evidence = promoteCandidate(reviewed.candidate);
  assert.equal(evidence.experiences.flatMap((experience) => experience.facts).includes("Wrote unit tests."), false);
});
