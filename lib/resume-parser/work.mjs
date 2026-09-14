import { parseDateRange } from "./dates.mjs";
import { extractedEntry } from "./extracted-entry.mjs";

const roleWords = /\b(engineer|developer|analyst|manager|designer|architect|consultant|intern|specialist|lead)\b/iu;

function textOf(line) {
  return typeof line === "string" ? line : line.text;
}

function sourceOf(line) {
  return typeof line === "string" ? null : line.source;
}

function identify(lines) {
  const texts = lines.map(textOf);
  const dated = texts.findIndex((line) => parseDateRange(line));
  if (dated < 1) return null;
  const before = texts.slice(0, dated);
  if (before.length !== 2) return null;
  const [first, second] = before;
  if (roleWords.test(first) === roleWords.test(second)) return null;
  const firstIsRole = roleWords.test(first);
  const dates = parseDateRange(texts[dated]);
  const value = firstIsRole
    ? { name: second, position: first, ...dates, highlights: texts.slice(dated + 1) }
    : { name: first, position: second, ...dates, highlights: texts.slice(dated + 1) };
  return extractedEntry(value, {
    name: sourceOf(lines[firstIsRole ? 1 : 0]),
    position: sourceOf(lines[firstIsRole ? 0 : 1]),
    startDate: sourceOf(lines[dated]),
    ...(dates.endDate ? { endDate: sourceOf(lines[dated]) } : {}),
    highlights: lines.slice(dated + 1).map(sourceOf),
  });
}

export function extractWork(lines, addIssue) {
  const work = [];
  let pending = [];
  for (const input of lines) {
    const line = textOf(input);
    const source = sourceOf(input);
    const pipe = line.split("|").map((value) => value.trim()).filter(Boolean);
    const pipeDates = parseDateRange(pipe.at(-1) ?? "");
    if (pipe.length >= 3 && pipeDates) {
      if (pending.length) addIssue("ambiguous_work_entry", "Could not safely associate this text with a company and role.", pending.map(textOf).join("\n"));
      pending = [];
      work.push(extractedEntry({ name: pipe[0], position: pipe[1], ...pipeDates, highlights: [] }, { name: source, position: source, startDate: source, ...(pipeDates.endDate ? { endDate: source } : {}), highlights: [] }));
      continue;
    }
    if (parseDateRange(line) && pending.length >= 2) {
      const entry = identify([...pending, input]);
      if (entry) work.push(entry);
      else addIssue("ambiguous_work_identity", "Could not distinguish company and role within this work block.", pending.map(textOf).join("\n"));
      pending = [];
    } else if (work.length && pending.length === 0 && roleWords.test(line)) {
      pending.push(input);
    } else if (work.length && (/^[•*-]\s*/u.test(line) || pending.length === 0)) {
      work.at(-1).value.highlights.push(line.replace(/^[•*-]\s*/u, ""));
      work.at(-1).sources.highlights.push(source);
    } else pending.push(input);
  }
  if (pending.length) addIssue("ambiguous_work_entry", "Could not safely associate this text with a company and role.", pending.map(textOf).join("\n"));
  return work;
}
