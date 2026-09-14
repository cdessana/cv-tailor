import { validateResume } from "./validate.mjs";
import { documentFromText } from "./layout.mjs";
import { extractWork } from "./work.mjs";
import { parseDateRange } from "./dates.mjs";

const sectionNames = new Map([
  ["experience", "work"], ["work experience", "work"], ["professional experience", "work"],
  ["education", "education"], ["skills", "skills"], ["technical skills", "skills"],
  ["certificates", "certificates"], ["certifications", "certificates"],
  ["languages", "languages"],
]);

function clean(value) {
  return value
    .replace(/^\s*(?:#+\s*|[-*•]|\d+[.)])\s*/u, "")
    .replace(/[*_`]/gu, "")
    .trim();
}

function isDate(value) {
  return /^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/u.test(value);
}

function splitSections(text) {
  const sections = { basics: [] };
  let current = "basics";
  for (const rawLine of text.split("\n")) {
    const line = clean(rawLine);
    if (!line) continue;
    const heading = line.toLowerCase();
    if (sectionNames.has(heading)) {
      current = sectionNames.get(heading);
      sections[current] ??= [];
      continue;
    }
    sections[current] ??= [];
    sections[current].push(line);
  }
  return sections;
}

function addIssue(issues, code, message, sourceText) {
  issues.push({ code, message, sourceText, requiresHumanReview: true });
}

function parseBasics(lines) {
  const basics = {};
  const email = lines.find((line) => /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(line));
  const phone = lines.find((line) => /\+?\d[\d ()-]{7,}\d/u.test(line));
  const urls = lines.flatMap((line) => line.match(/https?:\/\/[^\s|]+/gu) ?? []);
  const candidates = lines.filter((line) => !line.includes("@") && !/^https?:/iu.test(line) && !/\+?\d[\d ()-]{7,}\d/u.test(line));
  if (candidates[0]) basics.name = candidates[0];
  if (candidates[1]) basics.label = candidates[1];
  if (email) basics.email = email.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u)[0];
  if (phone) basics.phone = phone.match(/\+?\d[\d ()-]{7,}\d/u)[0];
  if (urls.length) basics.profiles = urls.map((url) => ({ network: /linkedin/iu.test(url) ? "LinkedIn" : "Website", url }));
  return basics;
}

function parseEducation(lines, issues) {
  const education = [];
  for (const line of lines) {
    const parts = line.split("|").map(clean).filter(Boolean);
    const dates = parseDateRange(parts.at(-1) ?? "");
    if (parts.length >= 2 && dates) education.push({ institution: parts[0], studyType: parts[1], ...dates });
    else addIssue(issues, "ambiguous_education_entry", "Could not safely identify institution, qualification, and dates.", line);
  }
  return education;
}

function parseNamedEntries(lines, key) {
  return lines.map((line) => {
    const [name, issuer] = line.split(/\s*(?:\||—|-)\s*/u).map(clean);
    return key === "certificates" ? { name, ...(issuer ? { issuer } : {}) } : { language: name, ...(issuer ? { fluency: issuer } : {}) };
  }).filter((entry) => entry.name || entry.language);
}

function parseSkills(lines) {
  return lines.map((line) => {
    const [name, keywords] = line.split(/:\s*/u, 2);
    return keywords ? { name: clean(name), keywords: keywords.split(",").map(clean).filter(Boolean) } : { name: clean(name) };
  }).filter((skill) => skill.name);
}

export function parseResumeText(text, { format = "txt" } = {}) {
  const issues = [];
  const sections = splitSections(text);
  const resume = { basics: parseBasics(sections.basics) };
  if (!resume.basics.name) addIssue(issues, "missing_name", "Could not identify the candidate name.", "");
  const work = extractWork(sections.work ?? [], (code, message, sourceText) => addIssue(issues, code, message, sourceText));
  const education = parseEducation(sections.education ?? [], issues);
  const skills = parseSkills(sections.skills ?? []);
  const certificates = parseNamedEntries(sections.certificates ?? [], "certificates");
  const languages = parseNamedEntries(sections.languages ?? [], "languages");
  if (work.length) resume.work = work;
  if (education.length) resume.education = education;
  if (skills.length) resume.skills = skills;
  if (certificates.length) resume.certificates = certificates;
  if (languages.length) resume.languages = languages;
  const validation = validateResume(resume);
  if (!validation.valid) issues.push(...validation.errors.map((error) => ({ code: "schema_validation", ...error, requiresHumanReview: true })));
  return {
    resume,
    report: {
      format,
      status: validation.valid && !issues.length ? "ready" : validation.valid ? "review_required" : "failed",
      summary: { workEntries: work.length, educationEntries: education.length, skills: skills.length, issues: issues.length },
      issues,
    },
  };
}

function sourceForValue(document, value) {
  if (!value || typeof value !== "string") return null;
  return document.lines.find((line) => line.text.includes(value))?.source ?? null;
}

function collectProvenance(value, path, document, entries) {
  if (typeof value === "string") {
    const source = sourceForValue(document, value);
    if (source) entries.push({ path, source });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectProvenance(entry, `${path}/${index}`, document, entries));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectProvenance(entry, `${path}/${key}`, document, entries);
    }
  }
}

export function parseResumeDocument(document) {
  const result = parseResumeText(document.text, { format: document.format });
  const provenance = [];
  collectProvenance(result.resume, "", document, provenance);
  result.report.provenance = provenance;
  return result;
}

export function parseResumeSourceText(text, options) {
  return parseResumeDocument(documentFromText(text, options));
}
