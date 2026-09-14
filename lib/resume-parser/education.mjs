import { parseDateRange } from "./dates.mjs";
import { extractedEntry } from "./extracted-entry.mjs";

const degreeWords = /\b(bachelor|master|mba|phd|degree|science|engineering|tecnologia|graduação|especialização)\b/iu;

function textOf(line) {
  return typeof line === "string" ? line : line.text;
}

function sourceOf(line) {
  return typeof line === "string" ? null : line.source;
}

export function extractEducationEntries(lines, addIssue = () => {}) {
  const education = [];
  let pending = [];
  for (const input of lines) {
    const line = textOf(input);
    const source = sourceOf(input);
    const parts = line.split("|").map((value) => value.trim()).filter(Boolean);
    const dates = parseDateRange(parts.at(-1) ?? "");
    if (parts.length >= 3 && dates) {
      education.push(extractedEntry(
        { institution: parts[0], studyType: parts[1], ...dates },
        { institution: source, studyType: source, startDate: source, ...(dates.endDate ? { endDate: source } : {}) }
      ));
      pending = [];
    } else if (parseDateRange(line) && pending.length === 2) {
      const [firstInput, secondInput] = pending;
      const first = textOf(firstInput);
      const second = textOf(secondInput);
      if (degreeWords.test(first) === degreeWords.test(second)) addIssue("ambiguous_education_identity", "Could not distinguish institution and qualification.", pending.map(textOf).join("\n"));
      else {
        const firstIsDegree = degreeWords.test(first);
        const value = firstIsDegree
          ? { institution: second, studyType: first, ...parseDateRange(line) }
          : { institution: first, studyType: second, ...parseDateRange(line) };
        education.push(extractedEntry(value, {
          institution: sourceOf(firstIsDegree ? secondInput : firstInput),
          studyType: sourceOf(firstIsDegree ? firstInput : secondInput),
          startDate: source,
          ...(value.endDate ? { endDate: source } : {}),
        }));
      }
      pending = [];
    } else pending.push(input);
  }
  for (const line of pending) addIssue("ambiguous_education_entry", "Could not safely identify an education entry.", textOf(line));
  return education;
}

export function extractEducation(lines, addIssue) {
  return extractEducationEntries(lines, addIssue).map((entry) => entry.value);
}
