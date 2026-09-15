import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyQuestionnaireAnswers, applyReviewDecisions, createCandidate, EvidenceBuilderError, promoteCandidate } from "../lib/evidence/builder.mjs";
import { assertEvidenceCandidate, assertEvidenceReport, EvidenceSchemaError } from "../lib/evidence/schema.mjs";
import { buildEvidence, getEvidenceCandidate, promoteEvidenceCandidate, reviewEvidenceCandidate } from "../server/services/evidence-builder-service.mjs";

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
  assert.equal(candidate.version, 2);
  assert.match(candidate.builderVersion, /^2\./);
  assert.match(candidate.runId, /^[\da-f-]{36}$/i);
  assert.equal(candidate.claims[0].originalClaim, candidate.claims[0].claim);
  assert.equal(candidate.claims[0].normalizedClaim, candidate.claims[0].claim);
  assert.doesNotThrow(() => assertEvidenceCandidate(candidate));
  assert.doesNotThrow(() => assertEvidenceReport(report));
});

test("records an auditable review decision with actor, timestamp, and source", () => {
  const { candidate } = createCandidate(resume);
  const result = applyReviewDecisions(candidate, [{ claimId: candidate.claims[0].id, status: "approved", note: "Confirmed against resume", actor: "candidate" }]);
  const decision = result.candidate.reviewDecisions[0];
  assert.equal(decision.claimId, candidate.claims[0].id);
  assert.equal(decision.actor, "candidate");
  assert.equal(decision.sources[0].reference, candidate.claims[0].source.reference);
  assert.ok(Date.parse(decision.decidedAt));
});

test("rejects candidates with dangling claim provenance", () => {
  const { candidate } = createCandidate(resume);
  candidate.claims[0].contextId = "context_missing";
  assert.throws(() => assertEvidenceCandidate(candidate), (error) => error instanceof EvidenceSchemaError && error.code === "EVIDENCE_SCHEMA_INVALID");
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

test("keeps corroborating external provenance and blocks explicit source conflicts", () => {
  const base = createCandidate(resume).candidate;
  const contextId = base.contexts[0].id;
  const corroborated = createCandidate(resume, {
    supportingSources: [{ type: "linkedin", reference: "linkedin:synthetic", claims: [{ contextId, claim: "Built REST APIs using Node.js and PostgreSQL." }] }],
  }).candidate;
  const claim = corroborated.claims.find((item) => item.originalClaim === "Built REST APIs using Node.js and PostgreSQL.");
  assert.equal(claim.sources.length, 2);
  assert.equal(claim.sources[1].type, "linkedin");

  const conflicted = createCandidate(resume, {
    supportingSources: [{ type: "feedback", reference: "feedback:manager", claims: [{ contextId, claim: "Built only GraphQL APIs.", conflictsWith: [claim.id] }] }],
  });
  assert.equal(conflicted.report.issues.some((issue) => issue.type === "source_claim_conflict"), true);
  assert.equal(conflicted.report.promotionSafe, false);
});

test("rejects external claims that cannot be tied to a resume context", () => {
  assert.throws(() => createCandidate(resume, {
    supportingSources: [{ type: "github", reference: "github:synthetic", claims: [{ contextId: "context_missing", claim: "Built a service." }] }],
  }), (error) => error.code === "EVIDENCE_SOURCE_CONTEXT_UNKNOWN");
});

test("requires an explicit conflicting value when resolving an issue", () => {
  const { candidate } = createCandidate(resume);
  const dates = candidate.questionnaire.questions.find((question) => question.key === "dates" && question.contextId === candidate.contexts[0].id);
  const conflicted = applyQuestionnaireAnswers(candidate, [{ questionId: dates.id, answer: "2022 — 2023" }]).candidate;
  const issue = conflicted.issues[0];
  assert.throws(() => applyReviewDecisions(conflicted, [{ issueId: issue.id, status: "resolved", values: [] }]), /Choose exactly one value/);
  const resolved = applyReviewDecisions(conflicted, [{ issueId: issue.id, status: "resolved", values: [issue.values[1]] }]);
  assert.equal(resolved.candidate.issues[0].resolved, true);
  assert.deepEqual(resolved.candidate.issues[0].resolution.values, [issue.values[1]]);
});

test("persists candidate and report together and can reload them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-builder-integration-"));
  const config = { paths: { output: path.join(root, "output"), baseResume: "unused", evidence: path.join(root, "evidence.json") } };
  const built = await buildEvidence({ resume, sourceReference: "fixture.json" }, { config });
  assert.equal((await fs.stat(built.paths.candidate)).isFile(), true);
  assert.equal((await fs.stat(built.paths.report)).isFile(), true);
  const loaded = await getEvidenceCandidate({ config });
  assert.equal(loaded.candidate.claims.length, built.candidate.claims.length);
  assert.equal(loaded.report.promotionSafe, false);
  await fs.rm(root, { recursive: true, force: true });
});

test("canonical output is written only by the promotion service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-builder-promotion-"));
  const config = { paths: { output: path.join(root, "output"), baseResume: "unused", evidence: path.join(root, "evidence.json") } };
  const built = await buildEvidence({ resume, sourceReference: "fixture.json" }, { config });
  await reviewEvidenceCandidate(built.candidate.claims.map((claim) => ({ claimId: claim.id, status: "approved" })), { config });
  const promoted = await promoteEvidenceCandidate({ config });
  const stored = JSON.parse(await fs.readFile(config.paths.evidence, "utf8"));
  assert.deepEqual(stored, promoted.evidence);
  await fs.rm(root, { recursive: true, force: true });
});
