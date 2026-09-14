import { parseDateRange } from "./dates.mjs";

const degreeWords = /\b(bachelor|master|mba|phd|degree|science|engineering|tecnologia|graduação|especialização)\b/iu;

export function extractEducation(lines, addIssue) {
  const education = [];
  let pending = [];
  for (const line of lines) {
    const parts = line.split("|").map((value) => value.trim()).filter(Boolean);
    const dates = parseDateRange(parts.at(-1) ?? "");
    if (parts.length >= 3 && dates) {
      education.push({ institution: parts[0], studyType: parts[1], ...dates });
      pending = [];
    } else if (parseDateRange(line) && pending.length === 2) {
      const [first, second] = pending;
      if (degreeWords.test(first) === degreeWords.test(second)) addIssue("ambiguous_education_identity", "Could not distinguish institution and qualification.", pending.join("\n"));
      else education.push(degreeWords.test(first)
        ? { institution: second, studyType: first, ...parseDateRange(line) }
        : { institution: first, studyType: second, ...parseDateRange(line) });
      pending = [];
    } else pending.push(line);
  }
  for (const line of pending) addIssue("ambiguous_education_entry", "Could not safely identify an education entry.", line);
  return education;
}
