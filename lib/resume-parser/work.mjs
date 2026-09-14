import { inspectDateRange, parseDateRange } from "./dates.mjs";
import { extractedEntry } from "./extracted-entry.mjs";

const roleWords = /(?<![\p{L}\p{N}_])(?:engineer|developer|analyst|manager|designer|architect|consultant|intern|specialist|lead|engenheir[oa]|desenvolvedor(?:a)?|analista|gerente|gestor(?:a)?|arquiteto(?:a)?|consultor(?:a)?|estagiári[oa]|especialista|líder|coordenador(?:a)?)(?![\p{L}\p{N}_])/iu;
const companySuffix = /\b(?:inc\.?|llc|ltd\.?|corp\.?|corporation|s\.?a\.?)$/iu;
const locationPrefix = /^(?:location|localização|localizacao|local)\s*:\s*/iu;

function textOf(line) {
  return typeof line === "string" ? line : line.text;
}

function sourceOf(line) {
  return typeof line === "string" ? null : line.source;
}

function explicitLocation(value) {
  const text = value.trim();
  if (locationPrefix.test(text)) return text.replace(locationPrefix, "").trim();
  if (/^(?:remote|hybrid|onsite|remoto|híbrido|presencial)(?:\b|\s*[-—|])/iu.test(text)) return text;
  if (!companySuffix.test(text) && /^[^,|]{2,},\s*[^,|]{2,}(?:,\s*[^,|]{2,})?$/u.test(text)) return text;
  return null;
}

function expandInlineIdentity(input) {
  const parts = textOf(input).split(/\s+[—–]\s+/u).map((value) => value.trim()).filter(Boolean);
  if (parts.length !== 2 || roleWords.test(parts[0]) === roleWords.test(parts[1])) return [input];
  return parts.map((text) => typeof input === "string" ? text : { text, source: input.source });
}

function identify(lines) {
  const texts = lines.map(textOf);
  const dated = texts.findIndex((line) => parseDateRange(line));
  if (dated < 1) return null;
  const before = texts.slice(0, dated);
  if (before.length < 2 || before.length > 3) return null;
  const roleIndexes = before.flatMap((value, index) => roleWords.test(value) ? [index] : []);
  if (roleIndexes.length !== 1) return null;
  const roleIndex = roleIndexes[0];
  const otherIndexes = before.map((_, index) => index).filter((index) => index !== roleIndex);
  const locationIndex = otherIndexes.find((index) => explicitLocation(before[index]));
  if (before.length === 3 && locationIndex === undefined) return null;
  const companyIndex = otherIndexes.find((index) => index !== locationIndex);
  if (companyIndex === undefined) return null;
  const dates = parseDateRange(texts[dated]);
  const value = {
    name: before[companyIndex],
    position: before[roleIndex],
    ...(locationIndex === undefined ? {} : { location: explicitLocation(before[locationIndex]) }),
    ...dates,
    highlights: texts.slice(dated + 1),
  };
  return extractedEntry(value, {
    name: sourceOf(lines[companyIndex]),
    position: sourceOf(lines[roleIndex]),
    ...(locationIndex === undefined ? {} : { location: sourceOf(lines[locationIndex]) }),
    startDate: sourceOf(lines[dated]),
    ...(dates.endDate ? { endDate: sourceOf(lines[dated]) } : {}),
    highlights: lines.slice(dated + 1).map(sourceOf),
  });
}

function identifyUndated(lines) {
  if (lines.length < 2) return null;
  const [first, second, ...highlights] = lines;
  const firstIsRole = roleWords.test(textOf(first));
  const secondIsRole = roleWords.test(textOf(second));
  if (firstIsRole === secondIsRole || highlights.some((line) => roleWords.test(textOf(line)))) return null;
  const role = firstIsRole ? first : second;
  const company = firstIsRole ? second : first;
  return extractedEntry(
    { name: textOf(company), position: textOf(role), highlights: highlights.map(textOf) },
    { name: sourceOf(company), position: sourceOf(role), highlights: highlights.map(sourceOf) }
  );
}

export function extractWork(lines, addIssue) {
  const work = [];
  let pending = [];
  for (const input of lines.flatMap(expandInlineIdentity)) {
    const line = textOf(input);
    const source = sourceOf(input);
    const pipe = line.split("|").map((value) => value.trim()).filter(Boolean);
    const pipeDateResult = inspectDateRange(pipe.at(-1) ?? "");
    const pipeDates = pipeDateResult.value;
    if (pipe.length >= 3 && pipeDates) {
      if (pending.length) addIssue("ambiguous_work_entry", "Could not safely associate this text with a company and role.", pending.map(textOf).join("\n"));
      pending = [];
      const location = pipe.length >= 4 ? pipe.slice(2, -1).join(" | ") : null;
      work.push(extractedEntry(
        { name: pipe[0], position: pipe[1], ...(location ? { location } : {}), ...pipeDates, highlights: [] },
        { name: source, position: source, ...(location ? { location: source } : {}), startDate: source, ...(pipeDates.endDate ? { endDate: source } : {}), highlights: [] }
      ));
      continue;
    }
    if (pipe.length >= 3 && pipeDateResult.error) {
      if (pending.length) addIssue("ambiguous_work_entry", "Could not safely associate this text with a company and role.", pending.map(textOf).join("\n"));
      addIssue("invalid_work_date", `The work date is invalid (${pipeDateResult.error}).`, line);
      pending = [];
      continue;
    }
    const lineDateResult = inspectDateRange(line);
    if (lineDateResult.value && pending.length >= 2) {
      const entry = identify([...pending, input]);
      if (entry) work.push(entry);
      else addIssue("ambiguous_work_identity", "Could not distinguish company and role within this work block.", pending.map(textOf).join("\n"));
      pending = [];
    } else if (lineDateResult.error && pending.length >= 2) {
      addIssue("invalid_work_date", `The work date is invalid (${lineDateResult.error}).`, line);
      pending = [];
    } else if (work.length && pending.length === 0 && roleWords.test(line)) {
      pending.push(input);
    } else if (work.length && (/^[•*-]\s*/u.test(line) || pending.length === 0)) {
      work.at(-1).value.highlights.push(line.replace(/^[•*-]\s*/u, ""));
      work.at(-1).sources.highlights.push(source);
    } else pending.push(input);
  }
  if (pending.length) {
    const undated = identifyUndated(pending);
    if (undated) {
      work.push(undated);
      addIssue("missing_work_dates", "The work entry has no explicit dates; no date precision was inferred.", pending.slice(0, 2).map(textOf).join("\n"));
    } else addIssue("ambiguous_work_entry", "Could not safely associate this text with a company and role.", pending.map(textOf).join("\n"));
  }
  return work;
}
