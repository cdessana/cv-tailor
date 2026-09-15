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
  for (const experience of data.experiences) {
    if (!experience || typeof experience !== "object" || Array.isArray(experience)) {
      throw new Error("Each experience entry must be an object.");
    }
    if (!experience.id || typeof experience.id !== "string") {
      throw new Error("Experience entry missing valid string 'id'.");
    }
    if (experienceIds.has(experience.id)) {
      throw new Error(`Experience ID '${experience.id}' is duplicated.`);
    }
    experienceIds.add(experience.id);
    if (!experience.company || typeof experience.company !== "string") {
      throw new Error(`Experience '${experience.id}' missing valid string 'company'.`);
    }
    if (!Array.isArray(experience.facts)) {
      throw new Error(`Experience '${experience.id}' facts must be an array of strings.`);
    }
    if (experience.facts.some((fact) => typeof fact !== "string" || !fact.trim())) {
      throw new Error(`Experience '${experience.id}' facts must contain non-empty strings.`);
    }
    if (experience.skills !== undefined && (!Array.isArray(experience.skills) || experience.skills.some((skill) => typeof skill !== "string" || !skill.trim()))) {
      throw new Error(`Experience '${experience.id}' skills must contain non-empty strings.`);
    }
  }
  return true;
}
