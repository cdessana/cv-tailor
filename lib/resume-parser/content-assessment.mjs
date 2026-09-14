const resumeSections = ["work", "education", "skills", "certificates", "languages", "summary"];
const basicSignals = ["label", "email", "phone", "location", "profiles", "summary"];

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" ? Boolean(value.trim()) : value != null;
}

export function assessResumeContent({ resume, sections }) {
  const namePresent = present(resume.basics?.name);
  const signals = [];
  for (const field of basicSignals) {
    if (present(resume.basics?.[field])) signals.push(`/basics/${field}`);
  }
  for (const section of resumeSections) {
    if (section !== "summary" && present(resume[section])) signals.push(`/${section}`);
    if (present(sections[section])) signals.push(`source:${section}`);
  }
  return {
    valid: namePresent && signals.length > 0,
    namePresent,
    signals: [...new Set(signals)],
  };
}
