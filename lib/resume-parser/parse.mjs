import { validateResume } from "./validate.mjs";
import { documentFromText } from "./layout.mjs";
import { extractWork } from "./work.mjs";
import { parseDateRange } from "./dates.mjs";
import { extractEducationEntries } from "./education.mjs";
import { extractCertificateEntries, extractLanguageEntries, extractSkillEntries } from "./sections.mjs";
import { parserStatus, reviewIssue } from "./review.mjs";
import { assembleExtractedEntries, assembleResume } from "./assemble.mjs";
import { textLines } from "./source-lines.mjs";
import { findEntryConflicts } from "./conflicts.mjs";

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

function splitSections(text, sourceLines = null) {
  const sections = { basics: [] };
  let current = "basics";
  for (const [index, rawLine] of (sourceLines ?? text.split("\n").map((value) => ({ text: value }))).entries()) {
    const line = clean(rawLine.text);
    if (!line) continue;
    const heading = line.toLowerCase();
    if (sectionNames.has(heading)) {
      current = sectionNames.get(heading);
      sections[current] ??= [];
      continue;
    }
    sections[current] ??= [];
    sections[current].push(sourceLines ? { text: line, source: rawLine.source } : line);
  }
  return sections;
}

function addIssue(issues, code, message, sourceText) {
  issues.push(reviewIssue(code, message, sourceText));
}

function parseBasicsEntries(lines) {
  const values = lines.map((line) => typeof line === "string" ? line : line.text);
  const basics = {};
  const sources = {};
  const email = values.find((line) => /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(line));
  const phone = values.find((line) => /\+?\d[\d ()-]{7,}\d/u.test(line));
  const urls = values.flatMap((line) => line.match(/https?:\/\/[^\s|]+/gu) ?? []);
  const candidates = values.filter((line) => !line.includes("@") && !/^https?:/iu.test(line) && !/\+?\d[\d ()-]{7,}\d/u.test(line));
  if (candidates[0]) { basics.name = candidates[0]; sources.name = lines[values.indexOf(candidates[0])]?.source ?? null; }
  if (candidates[1]) { basics.label = candidates[1]; sources.label = lines[values.indexOf(candidates[1])]?.source ?? null; }
  if (email) { basics.email = email.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u)[0]; sources.email = email; }
  if (phone) { basics.phone = phone.match(/\+?\d[\d ()-]{7,}\d/u)[0]; sources.phone = phone; }
  if (urls.length) basics.profiles = urls.map((url) => ({ network: /linkedin/iu.test(url) ? "LinkedIn" : "Website", url }));
  return { value: basics, sources };
}

function parseBasics(lines) { return parseBasicsEntries(lines).value; }

export function parseResumeText(text, { format = "txt", lines = null } = {}) {
  const issues = [];
  const sections = splitSections(text, lines);
  const basicsEntry = parseBasicsEntries(sections.basics);
  const basicsAssembly = assembleExtractedEntries([basicsEntry]);
  const resume = { basics: basicsAssembly.values[0] };
  if (!resume.basics.name) addIssue(issues, "missing_name", "Could not identify the candidate name.", "");
  const extractedWork = extractWork(sections.work ?? [], (code, message, sourceText) => addIssue(issues, code, message, sourceText));
  const workAssembly = assembleExtractedEntries(extractedWork);
  const work = workAssembly.values;
  const extractedEducation = extractEducationEntries(sections.education ?? [], (code, message, sourceText) => addIssue(issues, code, message, sourceText));
  const educationAssembly = assembleExtractedEntries(extractedEducation);
  const education = educationAssembly.values;
  const extractedSkills = extractSkillEntries(sections.skills ?? []);
  const skillAssembly = assembleExtractedEntries(extractedSkills);
  const skills = skillAssembly.values;
  const extractedCertificates = extractCertificateEntries(sections.certificates ?? []);
  const certificateAssembly = assembleExtractedEntries(extractedCertificates);
  const certificates = certificateAssembly.values;
  issues.push(...findEntryConflicts(extractedWork, "work"));
  issues.push(...findEntryConflicts(extractedEducation, "education"));
  issues.push(...findEntryConflicts(extractedCertificates, "certificates"));
  const extractedLanguages = extractLanguageEntries(sections.languages ?? []);
  const languageAssembly = assembleExtractedEntries(extractedLanguages);
  const languages = languageAssembly.values;
  issues.push(...findEntryConflicts(extractedLanguages, "languages"));
  issues.push(...findEntryConflicts(extractedSkills, "skills"));
  if (work.length) resume.work = work;
  if (education.length) resume.education = education;
  if (skills.length) resume.skills = skills;
  if (certificates.length) resume.certificates = certificates;
  if (languages.length) resume.languages = languages;
  const assembled = assembleResume(resume, { issues, provenance: [
    ...basicsAssembly.provenance.map((entry) => ({ ...entry, path: `/basics${entry.path.replace(/^\/0/u, "")}` })),
    ...workAssembly.provenance.map((entry) => ({ ...entry, path: `/work${entry.path}` })),
    ...educationAssembly.provenance.map((entry) => ({ ...entry, path: `/education${entry.path}` })),
    ...certificateAssembly.provenance.map((entry) => ({ ...entry, path: `/certificates${entry.path}` })),
    ...languageAssembly.provenance.map((entry) => ({ ...entry, path: `/languages${entry.path}` })),
    ...skillAssembly.provenance.map((entry) => ({ ...entry, path: `/skills${entry.path}` })),
  ] });
  return {
    resume: assembled.resume,
    report: {
      format,
      status: parserStatus({ valid: assembled.valid, issues: assembled.issues }),
      summary: { workEntries: work.length, educationEntries: education.length, skills: skills.length, issues: issues.length },
      issues: assembled.issues,
      provenance: assembled.provenance,
    },
  };
}

export function parseResumeDocument(document) {
  const result = parseResumeText(document.text, { format: document.format, lines: document.lines });
  return result;
}

export function parseResumeSourceText(text, options) {
  return parseResumeDocument(documentFromText(text, options));
}
