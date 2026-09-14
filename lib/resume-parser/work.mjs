import { parseDateRange } from "./dates.mjs";

const roleWords = /\b(engineer|developer|analyst|manager|designer|architect|consultant|intern|specialist|lead)\b/iu;

function identify(lines) {
  const dated = lines.findIndex((line) => parseDateRange(line));
  if (dated < 1) return null;
  const before = lines.slice(0, dated);
  if (before.length !== 2) return null;
  const [first, second] = before;
  if (roleWords.test(first) === roleWords.test(second)) return null;
  return roleWords.test(first)
    ? { name: second, position: first, ...parseDateRange(lines[dated]), highlights: lines.slice(dated + 1) }
    : { name: first, position: second, ...parseDateRange(lines[dated]), highlights: lines.slice(dated + 1) };
}

export function extractWork(lines, addIssue) {
  const work = [];
  let pending = [];
  for (const line of lines) {
    const pipe = line.split("|").map((value) => value.trim()).filter(Boolean);
    const pipeDates = parseDateRange(pipe.at(-1) ?? "");
    if (pipe.length >= 3 && pipeDates) {
      if (pending.length) addIssue("ambiguous_work_entry", "Could not safely associate this text with a company and role.", pending.join("\n"));
      pending = [];
      work.push({ name: pipe[0], position: pipe[1], ...pipeDates, highlights: [] });
      continue;
    }
    if (parseDateRange(line) && pending.length >= 2) {
      const entry = identify([...pending, line]);
      if (entry) work.push(entry);
      else addIssue("ambiguous_work_identity", "Could not distinguish company and role within this work block.", pending.join("\n"));
      pending = [];
    } else if (work.length && pending.length === 0 && roleWords.test(line)) {
      pending.push(line);
    } else if (work.length && (/^[•*-]\s*/u.test(line) || pending.length === 0)) {
      work.at(-1).highlights.push(line.replace(/^[•*-]\s*/u, ""));
    } else pending.push(line);
  }
  if (pending.length) addIssue("ambiguous_work_entry", "Could not safely associate this text with a company and role.", pending.join("\n"));
  return work;
}
