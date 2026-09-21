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

    // Check for a heading and bullet squashed together (e.g., "Obrigatório• Graduação...")
    const squashed = content.match(/^([\p{L}\p{N}\s,':()-]*?\p{L}[\p{L}\p{N}\s,':()-]*?)\s*(•|◦|▪|\d+\.(?!\d)|\d+\))\s*(.+)$/u);
    if (squashed && !/^(?:http|https)$/iu.test(squashed[1].trim())) {
      const headingText = squashed[1].trim();
      const bulletChar = squashed[2];
      const bulletText = squashed[3].trim();

      if (headingText && bulletText) {
        const headingRaw = indentation + headingText;
        const headingStart = match.index;
        const headingEnd = headingStart + headingRaw.length;
        const markerOffset = content.indexOf(bulletChar, headingText.length);
        const bulletStart = match.index + indentation.length + markerOffset;
        const bulletEnd = match.index + raw.length;

        // Push heading line
        lines.push({
          start: headingStart,
          end: headingEnd,
          indentation,
          text: normalizeInline(headingText),
          bullet: false,
          blank: false,
        });

        // Push bullet line
        lines.push({
          start: Math.max(headingEnd, bulletStart),
          end: bulletEnd,
          indentation,
          text: normalizeInline(bulletText),
          bullet: true,
          blank: false,
        });

        continue;
      }
    }

    const bullet = content.match(/^(?:[-*+•◦▪]|\d+[.)])[^\S\r\n]+(.*)$/u);
    const normalized = normalizeInline(bullet ? bullet[1] : content);
    // Archive exports use horizontal rules to separate unrelated blocks. They
    // are formatting, not prose, and must break adjacent semantic units.
    const separator = /^[=-]{3,}$/u.test(content.trim());
    lines.push({
      start: match.index,
      end: match.index + raw.length,
      indentation,
      text: normalized,
      bullet: Boolean(bullet),
      blank: raw.trim() === "" || separator,
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
