import { inspectDateRange } from "./dates.mjs";
import { extractedEntry } from "./extracted-entry.mjs";

const proficiency = "beginner|basic|intermediate|advanced|expert|proficient|master|iniciante|básico|basico|intermediário|intermediario|avançado|avancado|especialista";

function splitEntry(line) {
  return (typeof line === "string" ? line : line.text).split(/\s*(?:\||—)\s*/u).map((value) => value.trim()).filter(Boolean);
}

export function sourceOf(line) {
  return typeof line === "string" ? null : line.source;
}

export function extractCertificateEntries(lines, addIssue = () => {}) {
  return lines.map((line) => {
    const parts = splitEntry(line);
    const source = sourceOf(line);
    const url = parts.find((part) => /^https?:\/\//iu.test(part));
    const datePart = parts.find((part) => inspectDateRange(part).value || inspectDateRange(part).error);
    const dateResult = datePart ? inspectDateRange(datePart) : { value: null, error: null };
    if (dateResult.error) addIssue("invalid_certificate_date", `The certificate date is invalid (${dateResult.error}).`, textOf(line));
    const descriptive = parts.filter((part) => part !== url && part !== datePart);
    const [name, issuer] = descriptive;
    const date = dateResult.value?.startDate;
    return extractedEntry(
      { name, ...(issuer ? { issuer } : {}), ...(date ? { date } : {}), ...(url ? { url } : {}) },
      { name: source, ...(issuer ? { issuer: source } : {}), ...(date ? { date: source } : {}), ...(url ? { url: source } : {}) }
    );
  }).filter((entry) => entry.value.name);
}

export function extractCertificates(lines) {
  return extractCertificateEntries(lines).map((entry) => entry.value);
}

export function extractLanguages(lines) {
  return extractLanguageEntries(lines).map((entry) => entry.value);
}

export function extractLanguageEntries(lines) {
  return lines.map((line) => {
    const text = typeof line === "string" ? line : line.text;
    const [language, fluency] = text.split(/\s*(?:\||—|:)\s*/u).map((value) => value.trim());
    const source = sourceOf(line);
    return extractedEntry({ language, ...(fluency ? { fluency } : {}) }, { language: source, ...(fluency ? { fluency: source } : {}) });
  }).filter((entry) => entry.value.language);
}

export function extractSkills(lines) {
  return extractSkillEntries(lines).map((entry) => entry.value);
}

export function extractSkillEntries(lines) {
  return lines.map((line) => {
    const text = typeof line === "string" ? line : line.text;
    const source = sourceOf(line);
    const pipe = text.split(/\s*\|\s*/u).map((value) => value.trim()).filter(Boolean);
    const parenthesized = text.match(new RegExp(`^(.+?)\\s*[([]\\s*(?:level|nível)?\\s*:?\\s*(${proficiency})\\s*[)\\]]\\s*:\\s*(.+)$`, "iu"));
    const explicitLevel = text.match(/^(.+?)\s*[—-]\s*(?:level|nível)\s*:\s*(.+)$/iu);
    let name;
    let level;
    let keywords;
    if (pipe.length === 3) [name, level, keywords] = pipe;
    else if (parenthesized) [, name, level, keywords] = parenthesized;
    else if (explicitLevel) [, name, level] = explicitLevel;
    else [name, keywords] = text.split(/:\s*/u, 2);
    const value = {
      name: name.trim(),
      ...(level?.trim() ? { level: level.trim() } : {}),
      ...(keywords ? { keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
    };
    return extractedEntry(value, {
      name: source,
      ...(value.level ? { level: source } : {}),
      ...(value.keywords ? { keywords: value.keywords.map(() => source) } : {}),
    });
  }).filter((entry) => entry.value.name);
}

function textOf(line) {
  return typeof line === "string" ? line : line.text;
}
