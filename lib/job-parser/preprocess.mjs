import { buildSections } from "./sections.mjs";

// Horizontal whitespace only: line boundaries carry structural information.
function normalizeInline(text) {
  return text.replace(/[^\S\r\n]+/gu, " ").trim();
}

function scanLines(text) {
  const lines = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (const match of text.matchAll(pattern)) {
    if (match[0] === "") break;
    const raw = match[1];
    const indentation = raw.match(/^[^\S\r\n]*/u)[0];
    const content = raw.slice(indentation.length);
    const bullet = content.match(/^(?:[-*+•◦▪]|\d+[.)])[^\S\r\n]+(.*)$/u);
    const normalized = normalizeInline(bullet ? bullet[1] : content);
    lines.push({
      start: match.index,
      end: match.index + raw.length,
      indentation,
      text: normalized,
      bullet: Boolean(bullet),
      blank: raw.trim() === "",
    });
  }
  return lines;
}

/** Normalize document formatting without extracting requirements. */
export function preprocessJobDescription(text) {
  if (typeof text !== "string") {
    throw new TypeError("Job description must be a string.");
  }
  const lines = scanLines(text);
  const normalizedLines = [];
  for (const line of lines) {
    if (line.blank) {
      if (normalizedLines.length && normalizedLines.at(-1) !== "") {
        normalizedLines.push("");
      }
    } else {
      normalizedLines.push(line.bullet ? `- ${line.text}` : line.text);
    }
  }
  if (normalizedLines.at(-1) === "") normalizedLines.pop();

  return {
    originalText: text,
    normalizedText: normalizedLines.join("\n"),
    sections: buildSections(lines, text),
  };
}
