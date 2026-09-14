function splitEntry(line) {
  return line.split(/\s*(?:\||—)\s*/u).map((value) => value.trim()).filter(Boolean);
}

export function extractCertificates(lines) {
  return lines.map((line) => {
    const [name, issuer] = splitEntry(line);
    return { name, ...(issuer ? { issuer } : {}) };
  }).filter((entry) => entry.name);
}

export function extractLanguages(lines) {
  return lines.map((line) => {
    const [language, fluency] = line.split(/\s*(?:\||—|:)\s*/u).map((value) => value.trim());
    return { language, ...(fluency ? { fluency } : {}) };
  }).filter((entry) => entry.language);
}

export function extractSkills(lines) {
  return lines.map((line) => {
    const [name, keywords] = line.split(/:\s*/u, 2);
    return keywords ? { name: name.trim(), keywords: keywords.split(",").map((value) => value.trim()).filter(Boolean) } : { name: line.trim() };
  }).filter((entry) => entry.name);
}
