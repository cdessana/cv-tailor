import fs from "node:fs/promises";
import path from "node:path";
export { validateEvidenceStructure } from "../../lib/evidence/canonical-schema.mjs";

const EVIDENCE_PATH = path.resolve(process.cwd(), "data", "evidence.json");
const REVIEW_QUEUE_PATH = path.resolve(process.cwd(), "data", ".evidence-review-queue.json");
const BASE_RESUME_PATH = path.resolve(process.cwd(), "data", "resumes", "base.json");

/**
 * Load base resume safely
 */
export async function loadBaseResume() {
  try {
    const raw = await fs.readFile(BASE_RESUME_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

/**
 * Load evidence.json safely
 */
export async function loadEvidence() {
  try {
    const raw = await fs.readFile(EVIDENCE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 2, skills: {}, experiences: [] };
    }
    throw error;
  }
}

/**
 * Load review queue safely
 */
export async function loadReviewQueue() {
  try {
    const raw = await fs.readFile(REVIEW_QUEUE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    return [];
  }
}

/**
 * Save review queue safely
 */
export async function saveReviewQueue(queue) {
  const tempPath = `${REVIEW_QUEUE_PATH}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(queue, null, 2), "utf8");
  await fs.rename(tempPath, REVIEW_QUEUE_PATH);
}

/**
 * Get summary metrics for the Evidence Base header
 */
export async function getEvidenceSummary() {
  const evidence = await loadEvidence();
  const queue = await loadReviewQueue();

  const experiences = evidence.experiences || [];
  const skills = evidence.skills || {};

  let totalFacts = 0;
  for (const exp of experiences) {
    totalFacts += (exp.facts || []).length;
  }

  const pendingCount = queue.filter((item) => item.status === "pending").length;
  const conflictCount = queue.filter((item) => item.status === "conflict").length;

  return {
    experiencesCount: experiences.length,
    skillsCount: Object.keys(skills).length,
    factsCount: totalFacts,
    pendingReviewCount: pendingCount,
    conflictsCount: conflictCount,
    queueTotal: queue.length,
    version: evidence.version || 2,
  };
}

/**
 * Filter catalog by search query and criteria
 */
export async function getEvidenceCatalog({ query = "", skill = "", company = "", type = "" } = {}) {
  const evidence = await loadEvidence();
  let experiences = [...(evidence.experiences || [])];

  const q = query.toLowerCase().trim();
  const targetSkill = skill.toLowerCase().trim();
  const targetCompany = company.toLowerCase().trim();
  const targetType = type.toLowerCase().trim();

  if (q) {
    experiences = experiences.filter((exp) => {
      const matchCompany = exp.company?.toLowerCase().includes(q);
      const matchPosition = exp.position?.toLowerCase().includes(q);
      const matchFacts = (exp.facts || []).some((f) => f.toLowerCase().includes(q));
      const matchSkills = (exp.skills || []).some((s) => s.toLowerCase().includes(q));
      return matchCompany || matchPosition || matchFacts || matchSkills;
    });
  }

  if (targetSkill) {
    experiences = experiences.filter((exp) =>
      (exp.skills || []).some((s) => s.toLowerCase() === targetSkill)
    );
  }

  if (targetCompany) {
    experiences = experiences.filter((exp) =>
      exp.company?.toLowerCase().includes(targetCompany)
    );
  }

  if (targetType) {
    experiences = experiences.filter((exp) =>
      exp.type?.toLowerCase() === targetType
    );
  }

  // Calculate skill frequencies across all experiences
  const allExperiences = evidence.experiences || [];
  const skillFrequencies = {};
  for (const exp of allExperiences) {
    for (const s of (exp.skills || [])) {
      skillFrequencies[s] = (skillFrequencies[s] || 0) + 1;
    }
  }

  // Load candidate base resume skills with categories
  let baseSkills = [];
  try {
    const baseResume = await loadBaseResume();
    if (baseResume && Array.isArray(baseResume.skills)) {
      baseSkills = baseResume.skills;
    }
  } catch {
    baseSkills = [];
  }

  return {
    experiences,
    skills: evidence.skills || {},
    skillFrequencies,
    baseSkills,
    totalCount: (evidence.experiences || []).length,
    filteredCount: experiences.length,
  };
}

/**
 * Submit newly collected career facts into the Review Queue.
 * Prevents unvetted claims from directly corrupting evidence.json.
 */
export async function submitToReviewQueue({
  company,
  position,
  period,
  facts = [],
  skills = [],
  source = "interview", // "interview" | "manual" | "resume_upload"
  provenance = {},
}) {
  if (!company?.trim()) throw new Error("Company is required.");
  if (!position?.trim()) throw new Error("Position is required.");
  if (!facts.length && !skills.length) {
    throw new Error("Must provide at least one fact or skill.");
  }

  const queue = await loadReviewQueue();
  const evidence = await loadEvidence();

  // Check for conflicts with existing experiences (e.g. date mismatch)
  const existingExp = (evidence.experiences || []).find(
    (e) => e.company?.toLowerCase() === company.toLowerCase() &&
           e.position?.toLowerCase() === position.toLowerCase()
  );

  let initialStatus = "pending";
  let conflictDetails = null;

  if (existingExp && period && existingExp.period && existingExp.period !== period) {
    initialStatus = "conflict";
    conflictDetails = {
      type: "period_mismatch",
      existingPeriod: existingExp.period,
      submittedPeriod: period,
      message: `Date conflict: existing period is "${existingExp.period}", but submitted period is "${period}".`,
    };
  }

  const item = {
    id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    company: company.trim(),
    position: position.trim(),
    period: period?.trim() || existingExp?.period || "Present",
    facts: facts.filter(Boolean),
    skills: skills.filter(Boolean),
    source,
    provenance,
    status: initialStatus,
    conflictDetails,
    createdAt: new Date().toISOString(),
  };

  queue.unshift(item);
  await saveReviewQueue(queue);
  return item;
}

/**
 * Reject a review queue item
 */
export async function rejectQueueItem(itemId, reason = "") {
  const queue = await loadReviewQueue();
  const index = queue.findIndex((i) => i.id === itemId);
  if (index === -1) throw new Error(`Queue item ${itemId} not found`);

  queue[index].status = "rejected";
  queue[index].rejectionReason = reason;
  queue[index].rejectedAt = new Date().toISOString();
  await saveReviewQueue(queue);
  return queue[index];
}
