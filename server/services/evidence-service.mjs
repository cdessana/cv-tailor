import fs from "node:fs/promises";
import path from "node:path";

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
 * Save evidence.json atomically
 */
export async function saveEvidence(data) {
  validateEvidenceStructure(data);
  throw new Error("Canonical evidence can only be written through Evidence Builder promotion.");
}

/**
 * Validates evidence.json schema
 */
export function validateEvidenceStructure(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Evidence data must be an object.");
  }
  if (!data.version || typeof data.version !== "number") {
    throw new Error("Evidence data must have a numeric version (e.g. 2).");
  }
  if (!data.skills || typeof data.skills !== "object" || Array.isArray(data.skills)) {
    throw new Error("Evidence data must have a skills object dictionary.");
  }
  if (!Array.isArray(data.experiences)) {
    throw new Error("Evidence data must have an experiences array.");
  }
  const experienceIds = new Set();
  for (const exp of data.experiences) {
    if (!exp || typeof exp !== "object" || Array.isArray(exp)) {
      throw new Error("Each experience entry must be an object.");
    }
    if (!exp.id || typeof exp.id !== "string") {
      throw new Error(`Experience entry missing valid string 'id'.`);
    }
    if (experienceIds.has(exp.id)) {
      throw new Error(`Experience ID '${exp.id}' is duplicated.`);
    }
    experienceIds.add(exp.id);
    if (!exp.company || typeof exp.company !== "string") {
      throw new Error(`Experience '${exp.id}' missing valid string 'company'.`);
    }
    if (!Array.isArray(exp.facts)) {
      throw new Error(`Experience '${exp.id}' facts must be an array of strings.`);
    }
    if (exp.facts.some((fact) => typeof fact !== "string" || !fact.trim())) {
      throw new Error(`Experience '${exp.id}' facts must contain non-empty strings.`);
    }
    if (exp.skills !== undefined && (!Array.isArray(exp.skills) || exp.skills.some((skill) => typeof skill !== "string" || !skill.trim()))) {
      throw new Error(`Experience '${exp.id}' skills must contain non-empty strings.`);
    }
  }
  return true;
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
 * Update an existing experience in evidence.json
 */
export async function updateExperience(expId, expData) {
  const evidence = await loadEvidence();
  const experiences = evidence.experiences || [];
  const index = experiences.findIndex((e) => e.id === expId);

  if (index === -1) {
    throw new Error(`Experience with ID "${expId}" not found.`);
  }

  if (!expData.company?.trim()) throw new Error("Company name is required.");
  if (!expData.position?.trim()) throw new Error("Position/role is required.");

  const current = experiences[index];
  const updatedExp = {
    ...current,
    id: current.id,
    company: expData.company.trim(),
    position: expData.position.trim(),
    period: expData.period !== undefined ? expData.period.trim() : current.period,
    type: expData.type !== undefined ? expData.type.trim() : current.type || "professional",
    facts: Array.isArray(expData.facts)
      ? expData.facts.map((f) => String(f).trim()).filter(Boolean)
      : current.facts || [],
    skills: Array.isArray(expData.skills)
      ? expData.skills.map((s) => String(s).trim()).filter(Boolean)
      : current.skills || [],
  };

  // Add any new skills to the skills registry in evidence.json
  evidence.skills = evidence.skills || {};
  for (const s of updatedExp.skills) {
    if (!evidence.skills[s]) {
      evidence.skills[s] = { level: "experienced" };
    }
  }

  experiences[index] = updatedExp;
  evidence.experiences = experiences;

  await saveEvidence(evidence);
  return updatedExp;
}

/**
 * Delete an existing experience from evidence.json
 */
export async function deleteExperience(expId) {
  const evidence = await loadEvidence();
  const experiences = evidence.experiences || [];
  const index = experiences.findIndex((e) => e.id === expId);

  if (index === -1) {
    throw new Error(`Experience with ID "${expId}" not found.`);
  }

  const [removed] = experiences.splice(index, 1);
  evidence.experiences = experiences;

  await saveEvidence(evidence);
  return { success: true, removed };
}

/**
 * Add a new experience directly to evidence.json (approved)
 */
export async function addExperience(expData) {
  const evidence = await loadEvidence();

  if (!expData.company?.trim()) throw new Error("Company name is required.");
  if (!expData.position?.trim()) throw new Error("Position/role is required.");

  const slugId = (expData.id || `${expData.company}-${expData.position}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const newExp = {
    id: slugId,
    company: expData.company.trim(),
    position: expData.position.trim(),
    period: expData.period?.trim() || "Present",
    type: expData.type?.trim() || "professional",
    facts: Array.isArray(expData.facts) ? expData.facts.filter(Boolean) : [],
    skills: Array.isArray(expData.skills) ? expData.skills.filter(Boolean) : [],
  };

  // Add any new skills to the skills registry
  evidence.skills = evidence.skills || {};
  for (const s of newExp.skills) {
    if (!evidence.skills[s]) {
      evidence.skills[s] = { level: "experienced" };
    }
  }

  evidence.experiences = evidence.experiences || [];
  const existingIndex = evidence.experiences.findIndex((e) => e.id === newExp.id);
  if (existingIndex >= 0) {
    evidence.experiences[existingIndex] = newExp;
  } else {
    evidence.experiences.push(newExp);
  }

  await saveEvidence(evidence);
  return newExp;
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
 * Approve a review queue item and merge into evidence.json
 */
export async function approveQueueItem(itemId, options = {}) {
  const queue = await loadReviewQueue();
  const index = queue.findIndex((i) => i.id === itemId);
  if (index === -1) throw new Error(`Queue item ${itemId} not found`);

  const item = queue[index];
  const evidence = await loadEvidence();

  // Selected period if resolved conflict
  const effectivePeriod = options.resolvedPeriod || item.period;
  const effectiveFacts = options.facts || item.facts;
  const effectiveSkills = options.skills || item.skills;

  // Find or create experience
  let exp = (evidence.experiences || []).find(
    (e) => e.company?.toLowerCase() === item.company.toLowerCase() &&
           e.position?.toLowerCase() === item.position.toLowerCase()
  );

  if (exp) {
    exp.period = effectivePeriod;
    // Add non-duplicate facts
    for (const f of effectiveFacts) {
      if (!exp.facts.includes(f)) {
        exp.facts.push(f);
      }
    }
    // Add non-duplicate skills
    for (const s of effectiveSkills) {
      if (!exp.skills.includes(s)) {
        exp.skills.push(s);
      }
    }
  } else {
    const slugId = `${item.company}-${item.position}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    exp = {
      id: slugId,
      company: item.company,
      position: item.position,
      period: effectivePeriod,
      type: "professional",
      facts: [...effectiveFacts],
      skills: [...effectiveSkills],
    };
    evidence.experiences.push(exp);
  }

  // Register skills
  evidence.skills = evidence.skills || {};
  for (const s of effectiveSkills) {
    if (!evidence.skills[s]) {
      evidence.skills[s] = { level: "experienced" };
    }
  }

  await saveEvidence(evidence);

  // Update item status
  item.status = "approved";
  item.approvedAt = new Date().toISOString();
  await saveReviewQueue(queue);

  return { success: true, item, updatedExperience: exp };
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
