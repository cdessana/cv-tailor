import { inspectDateRange } from "./dates.mjs";
import { extractedEntry } from "./extracted-entry.mjs";

const degreeWords = /\b(bachelor|master|mba|phd|degree|science|engineering|tecnologia|graduação|especialização)\b/iu;
const degreeAreaPattern = /^((?:bachelor|master)(?:'s)?(?:\s+of\s+(?:science|arts|engineering))?|degree|graduação|graduacao|bacharelado|mestrado|especialização|especializacao)\s+(?:in|em)\s+(.+)$/iu;

function textOf(line) {
  return typeof line === "string" ? line : line.text;
}

function sourceOf(line) {
  return typeof line === "string" ? null : line.source;
}

function qualification(value) {
  const match = value.match(degreeAreaPattern);
  return match ? { studyType: match[1], area: match[2] } : { studyType: value };
}

export function extractEducationEntries(lines, addIssue = () => {}) {
  const education = [];
  let pending = [];
  for (const input of lines) {
    const line = textOf(input);
    const source = sourceOf(input);
    const parts = line.split("|").map((value) => value.trim()).filter(Boolean);
    const dateResult = inspectDateRange(parts.at(-1) ?? "");
    const dates = dateResult.value;
    const lineDateResult = parts.length >= 3 ? dateResult : inspectDateRange(line);
    if (parts.length >= 3 && dates) {
      const parsedQualification = qualification(parts[1]);
      const area = parts.length >= 4 ? parts.slice(2, -1).join(" | ") : parsedQualification.area;
      education.push(extractedEntry(
        { institution: parts[0], studyType: parsedQualification.studyType, ...(area ? { area } : {}), ...dates },
        { institution: source, studyType: source, ...(area ? { area: source } : {}), startDate: source, ...(dates.endDate ? { endDate: source } : {}) }
      ));
      pending = [];
    } else if (parts.length >= 3 && dateResult.error) {
      addIssue("invalid_education_date", `The education date is invalid (${dateResult.error}).`, line);
      pending = [];
    } else if (lineDateResult.value && pending.length >= 2 && pending.length <= 3) {
      const areaInput = pending.length === 3
        ? pending.find((candidate) => /^(?:area|field|área)\s*:/iu.test(textOf(candidate)))
        : null;
      const identityInputs = pending.filter((candidate) => candidate !== areaInput);
      if (identityInputs.length !== 2) {
        addIssue("ambiguous_education_identity", "Could not distinguish institution, qualification, and area.", pending.map(textOf).join("\n"));
        pending = [];
        continue;
      }
      const [firstInput, secondInput] = identityInputs;
      const first = textOf(firstInput);
      const second = textOf(secondInput);
      if (degreeWords.test(first) === degreeWords.test(second)) addIssue("ambiguous_education_identity", "Could not distinguish institution and qualification.", pending.map(textOf).join("\n"));
      else {
        const firstIsDegree = degreeWords.test(first);
        const degreeInput = firstIsDegree ? firstInput : secondInput;
        const parsedQualification = qualification(textOf(degreeInput));
        const explicitArea = areaInput
          ? textOf(areaInput).replace(/^(?:area|field|área)\s*:\s*/iu, "").trim()
          : null;
        const value = {
          institution: firstIsDegree ? second : first,
          studyType: parsedQualification.studyType,
          ...(explicitArea || parsedQualification.area ? { area: explicitArea ?? parsedQualification.area } : {}),
          ...lineDateResult.value,
        };
        education.push(extractedEntry(value, {
          institution: sourceOf(firstIsDegree ? secondInput : firstInput),
          studyType: sourceOf(firstIsDegree ? firstInput : secondInput),
          ...(explicitArea || parsedQualification.area ? { area: sourceOf(areaInput ?? degreeInput) } : {}),
          startDate: source,
          ...(value.endDate ? { endDate: source } : {}),
        }));
      }
      pending = [];
    } else if (lineDateResult.error && pending.length >= 2 && pending.length <= 3) {
      addIssue("invalid_education_date", `The education date is invalid (${lineDateResult.error}).`, line);
      pending = [];
    } else pending.push(input);
  }
  for (const line of pending) addIssue("ambiguous_education_entry", "Could not safely identify an education entry.", textOf(line));
  return education;
}

export function extractEducation(lines, addIssue) {
  return extractEducationEntries(lines, addIssue).map((entry) => entry.value);
}
