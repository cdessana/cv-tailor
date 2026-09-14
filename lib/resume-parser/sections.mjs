function splitEntry(line) {
  return (typeof line === "string" ? line : line.text).split(/\s*(?:\||—)\s*/u).map((value) => value.trim()).filter(Boolean);
}

export function sourceOf(line) {
  return typeof line === "string" ? null : line.source;
}

export function extractCertificateEntries(lines) {
  return lines.map((line) => {
    const [name, issuer] = splitEntry(line);
    const source = sourceOf(line);
    return extractedEntry({ name, ...(issuer ? { issuer } : {}) }, { name: source, ...(issuer ? { issuer: source } : {}) });
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
    const [name, keywords] = text.split(/:\s*/u, 2);
    const value = keywords ? { name: name.trim(), keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean) } : { name: text.trim() };
    return extractedEntry(value, { name: source, ...(value.keywords ? { keywords: value.keywords.map(() => source) } : {}) });
  }).filter((entry) => entry.value.name);
}
import { extractedEntry } from "./extracted-entry.mjs";
