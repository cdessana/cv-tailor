import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/load-config.mjs";
import { loadEvidence } from "./evidence-service.mjs";
import { promoteApprovedEvidence } from "../../lib/evidence/promote.mjs";
import { applyQuestionnaireAnswers, applyReviewDecisions, createCandidate, createReport, EvidenceBuilderError, promoteCandidate } from "../../lib/evidence/builder.mjs";

function paths(config = loadConfig()) {
  const root = path.join(config.paths.output, "evidence");
  return { candidate: path.join(root, "evidence-candidate.json"), report: path.join(root, "evidence-report.json") };
}

async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, "utf8")); }

async function writeArtifacts(candidate, config) {
  const output = paths(config);
  await fs.mkdir(path.dirname(output.candidate), { recursive: true });
  const report = createReport(candidate);
  const token = `${process.pid}-${Date.now()}`;
  const candidateTmp = `${output.candidate}.${token}.tmp`;
  const reportTmp = `${output.report}.${token}.tmp`;
  const candidateBak = `${output.candidate}.${token}.bak`;
  const reportBak = `${output.report}.${token}.bak`;
  let candidateBackedUp = false;
  let reportBackedUp = false;
  let candidateInstalled = false;
  let reportInstalled = false;
  try {
    await Promise.all([
      fs.writeFile(candidateTmp, `${JSON.stringify(candidate, null, 2)}\n`),
      fs.writeFile(reportTmp, `${JSON.stringify(report, null, 2)}\n`),
    ]);
    try { await fs.rename(output.candidate, candidateBak); candidateBackedUp = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await fs.rename(output.report, reportBak); reportBackedUp = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    await fs.rename(candidateTmp, output.candidate); candidateInstalled = true;
    await fs.rename(reportTmp, output.report); reportInstalled = true;
    await Promise.allSettled([fs.rm(candidateBak, { force: true }), fs.rm(reportBak, { force: true })]);
  } catch (error) {
    await Promise.allSettled([
      fs.rm(candidateTmp, { force: true }), fs.rm(reportTmp, { force: true }),
      candidateInstalled ? fs.rm(output.candidate, { force: true }) : Promise.resolve(),
      reportInstalled ? fs.rm(output.report, { force: true }) : Promise.resolve(),
      candidateBackedUp ? fs.rename(candidateBak, output.candidate) : Promise.resolve(),
      reportBackedUp ? fs.rename(reportBak, output.report) : Promise.resolve(),
    ]);
    throw error;
  }
  return { candidate, report, paths: output };
}

export async function buildEvidence({ resume, sourceReference, supportingSources } = {}, { config = loadConfig() } = {}) {
  const input = resume ?? await readJson(config.paths.baseResume);
  const result = createCandidate(input, { sourceReference: sourceReference ?? config.paths.baseResume, supportingSources });
  return writeArtifacts(result.candidate, config);
}

export async function getEvidenceCandidate({ config = loadConfig() } = {}) {
  const output = paths(config);
  try {
    const candidate = await readJson(output.candidate);
    return { candidate, report: createReport(candidate), paths: output };
  } catch (error) {
    if (error.code === "ENOENT") throw new EvidenceBuilderError("EVIDENCE_CANDIDATE_NOT_FOUND", "Build evidence before requesting review.");
    throw error;
  }
}

export async function answerEvidenceQuestionnaire(answers, { config = loadConfig() } = {}) {
  const { candidate } = await getEvidenceCandidate({ config });
  return writeArtifacts(applyQuestionnaireAnswers(candidate, answers).candidate, config);
}

export async function reviewEvidenceCandidate(decisions, { config = loadConfig() } = {}) {
  const { candidate } = await getEvidenceCandidate({ config });
  return writeArtifacts(applyReviewDecisions(candidate, decisions).candidate, config);
}

export async function promoteEvidenceCandidate({ config = loadConfig() } = {}) {
  const { candidate } = await getEvidenceCandidate({ config });
  const evidence = promoteCandidate(candidate);
  await promoteApprovedEvidence(evidence, config.paths.evidence);
  return { evidence, report: createReport(candidate), canonicalPath: config.paths.evidence };
}

export async function evidenceBuilderStatus({ config = loadConfig() } = {}) {
  try {
    return await getEvidenceCandidate({ config });
  } catch (error) {
    if (error.code === "EVIDENCE_CANDIDATE_NOT_FOUND") return { candidate: null, report: null, paths: paths(config), canonical: await loadEvidence() };
    throw error;
  }
}
