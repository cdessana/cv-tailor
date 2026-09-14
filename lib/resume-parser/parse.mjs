import { documentFromText } from "./layout.mjs";
import { extractWork } from "./work.mjs";
import { extractEducationEntries } from "./education.mjs";
import { extractCertificateEntries, extractLanguageEntries, extractSkillEntries } from "./sections.mjs";
import { parserStatus, reviewIssue } from "./review.mjs";
import { assembleExtractedEntries, assembleResume } from "./assemble.mjs";
import { findEntryConflicts } from "./conflicts.mjs";
import { extractBasicsEntry } from "./basics.mjs";

const sectionNames = new Map([
  ["experience", "work"], ["work experience", "work"], ["professional experience", "work"],
  ["education", "education"], ["skills", "skills"], ["technical skills", "skills"],
  ["certificates", "certificates"], ["certifications", "certificates"],
  ["languages", "languages"],
  ["summary", "summary"], ["professional summary", "summary"],
  ["profile", "summary"], ["professional profile", "summary"],
  ["resumo", "summary"], ["resumo profissional", "summary"],
  ["perfil", "summary"], ["perfil profissional", "summary"],
]);

function clean(value) {
  return value
    .replace(/^\s*(?:#+\s*|[-*•]|\d+[.)])\s*/u, "")
    .replace(/[*_`]/gu, "")
    .trim();
}

function splitSections(text, sourceLines = null) {
  const sections = { basics: [] };
  let current = "basics";
  for (const rawLine of (sourceLines ?? text.split("\n").map((value) => ({ text: value })))) {
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

export function parseResumeText(text, { format = "txt", lines = null } = {}) {
  const issues = [];
  const sections = splitSections(text, lines);
  const basicsEntry = extractBasicsEntry(sections.basics, { summaryLines: sections.summary ?? [] });
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
      summary: { workEntries: work.length, educationEntries: education.length, skills: skills.length, certificateEntries: certificates.length, languageEntries: languages.length, issues: assembled.issues.length },
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
