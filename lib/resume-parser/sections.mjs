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
  return lines.map((line) => {
    const [name, keywords] = line.split(/:\s*/u, 2);
    return keywords ? { name: name.trim(), keywords: keywords.split(",").map((value) => value.trim()).filter(Boolean) } : { name: line.trim() };
  }).filter((entry) => entry.name);
}
import { extractedEntry } from "./extracted-entry.mjs";
