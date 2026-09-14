import { parseDateRange } from "./dates.mjs";
import { extractedEntry } from "./extracted-entry.mjs";

const degreeWords = /\b(bachelor|master|mba|phd|degree|science|engineering|tecnologia|graduação|especialização)\b/iu;

export function extractEducationEntries(lines, addIssue = () => {}) {
  const education = [];
  let pending = [];
  for (const input of lines) {
    const line = typeof input === "string" ? input : input.text;
    const source = typeof input === "string" ? null : input.source;
    const parts = line.split("|").map((value) => value.trim()).filter(Boolean);
    const dates = parseDateRange(parts.at(-1) ?? "");
    if (parts.length >= 3 && dates) {
      education.push(extractedEntry(
        { institution: parts[0], studyType: parts[1], ...dates },
        { institution: source, studyType: source, startDate: source, ...(dates.endDate ? { endDate: source } : {}) }
      ));
      pending = [];
    } else if (parseDateRange(line) && pending.length === 2) {
      const [first, second] = pending;
      if (degreeWords.test(first) === degreeWords.test(second)) addIssue("ambiguous_education_identity", "Could not distinguish institution and qualification.", pending.join("\n"));
      else {
        const value = degreeWords.test(first)
          ? { institution: second, studyType: first, ...parseDateRange(line) }
          : { institution: first, studyType: second, ...parseDateRange(line) };
        education.push(extractedEntry(value, {
          institution: source, studyType: source, startDate: source,
          ...(value.endDate ? { endDate: source } : {}),
        }));
      }
      pending = [];
    } else pending.push(line);
  }
  for (const line of pending) addIssue("ambiguous_education_entry", "Could not safely identify an education entry.", line);
  return education;
}

export function extractEducation(lines, addIssue) {
  return extractEducationEntries(lines, addIssue).map((entry) => entry.value);
}
