export function textLines(document) {
  return document.lines.map((line) => line.text);
}

export function sectionLines(document, section) {
  const names = new Map([["experience", "work"], ["work experience", "work"], ["education", "education"], ["skills", "skills"], ["certificates", "certificates"], ["languages", "languages"]]);
  let current = "basics";
  const result = { basics: [] };
  for (const line of document.lines) {
    const heading = line.text.replace(/^#+\s*/u, "").trim().toLowerCase();
    if (names.has(heading)) { current = names.get(heading); result[current] ??= []; continue; }
    result[current] ??= [];
    result[current].push(line);
  }
  return result[section] ?? [];
}
