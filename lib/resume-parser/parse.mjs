import { validateResume } from "./validate.mjs";
import { documentFromText } from "./layout.mjs";
import { extractWork } from "./work.mjs";
import { parseDateRange } from "./dates.mjs";
import { extractEducation } from "./education.mjs";
import { extractCertificates, extractLanguages, extractSkills } from "./sections.mjs";
import { parserStatus, reviewIssue } from "./review.mjs";
import { assembleResume } from "./assemble.mjs";
import { createProvenanceResolver } from "./provenance.mjs";

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
  issues.push(reviewIssue(code, message, sourceText));
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

export function parseResumeText(text, { format = "txt" } = {}) {
  const issues = [];
  const sections = splitSections(text);
  const resume = { basics: parseBasics(sections.basics) };
  if (!resume.basics.name) addIssue(issues, "missing_name", "Could not identify the candidate name.", "");
  const work = extractWork(sections.work ?? [], (code, message, sourceText) => addIssue(issues, code, message, sourceText));
  const education = extractEducation(sections.education ?? [], (code, message, sourceText) => addIssue(issues, code, message, sourceText));
  const skills = extractSkills(sections.skills ?? []);
  const certificates = extractCertificates(sections.certificates ?? []);
  const languages = extractLanguages(sections.languages ?? []);
  if (work.length) resume.work = work;
  if (education.length) resume.education = education;
  if (skills.length) resume.skills = skills;
  if (certificates.length) resume.certificates = certificates;
  if (languages.length) resume.languages = languages;
  const assembled = assembleResume(resume, { issues });
  return {
    resume: assembled.resume,
    report: {
      format,
      status: parserStatus({ valid: assembled.valid, issues: assembled.issues }),
      summary: { workEntries: work.length, educationEntries: education.length, skills: skills.length, issues: issues.length },
      issues: assembled.issues,
    },
  };
}

function collectProvenance(value, path, resolveSource, entries) {
  if (typeof value === "string") {
    const source = resolveSource(value);
    if (source) entries.push({ path, source });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectProvenance(entry, `${path}/${index}`, resolveSource, entries));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectProvenance(entry, `${path}/${key}`, resolveSource, entries);
    }
  }
}

export function parseResumeDocument(document) {
  const result = parseResumeText(document.text, { format: document.format });
  const provenance = [];
  collectProvenance(result.resume, "", createProvenanceResolver(document.lines), provenance);
  result.report.provenance = provenance.sort((left, right) => left.path.localeCompare(right.path));
  return result;
}

export function parseResumeSourceText(text, options) {
  return parseResumeDocument(documentFromText(text, options));
}
