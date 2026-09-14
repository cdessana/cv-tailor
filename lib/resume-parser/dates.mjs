const months = new Map([
  ["jan", "01"], ["january", "01"], ["janeiro", "01"], ["feb", "02"], ["february", "02"], ["fevereiro", "02"], ["mar", "03"], ["march", "03"], ["março", "03"], ["apr", "04"], ["april", "04"], ["abril", "04"], ["may", "05"], ["maio", "05"], ["jun", "06"], ["june", "06"], ["junho", "06"], ["jul", "07"], ["july", "07"], ["julho", "07"], ["aug", "08"], ["august", "08"], ["agosto", "08"], ["sep", "09"], ["september", "09"], ["setembro", "09"], ["oct", "10"], ["october", "10"], ["outubro", "10"], ["nov", "11"], ["november", "11"], ["novembro", "11"], ["dec", "12"], ["december", "12"], ["dezembro", "12"],
]);

function normalizeDate(value) {
  const text = value.trim().toLowerCase().replace(/\.$/u, "");
  if (/^(19|20)\d{2}$/u.test(text)) return text;
  if (/^(0[1-9]|1[0-2])\/(19|20)\d{2}$/u.test(text)) return `${text.slice(3)}-${text.slice(0, 2)}`;
  if (/^(19|20)\d{2}-(0[1-9]|1[0-2])$/u.test(text)) return text;
  const fullDate = text.match(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u);
  if (fullDate) {
    const [, year, month, day] = fullDate;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)) return text;
    return null;
  }
  const match = text.match(/^([a-zç]+)\s+((?:19|20)\d{2})$/u);
  return match && months.has(match[1]) ? `${match[2]}-${months.get(match[1])}` : null;
}

function dateLike(value) {
  const text = value.trim().toLowerCase();
  return /(?:\b(?:19|20)\d{2}\b|\b\d{1,2}\/\d{4}\b|\b(?:present|current|atual)\b)/iu.test(text)
    || [...months.keys()].some((month) => new RegExp(`\\b${month}\\b`, "iu").test(text));
}

function earliestDate(value) {
  if (/^\d{4}$/u.test(value)) return `${value}-01-01`;
  if (/^\d{4}-\d{2}$/u.test(value)) return `${value}-01`;
  return value;
}

function latestDate(value) {
  if (/^\d{4}$/u.test(value)) return `${value}-12-31`;
  if (/^\d{4}-\d{2}$/u.test(value)) {
    const [year, month] = value.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${value}-${String(lastDay).padStart(2, "0")}`;
  }
  return value;
}

export function inspectDateRange(value) {
  const parts = value.split(/\s+(?:-|–|—|to|até|a)\s+/iu).filter(Boolean);
  const startDate = normalizeDate(parts[0] ?? "");
  if (!startDate) return dateLike(value)
    ? { value: null, error: "invalid_start_date" }
    : { value: null, error: null };
  if (parts.length > 2) return { value: null, error: "invalid_date_range" };
  const end = parts[1]?.trim();
  if (!end || /^(present|current|atual)$/iu.test(end)) return { value: { startDate }, error: null };
  const endDate = normalizeDate(end);
  if (!endDate) return { value: null, error: "invalid_end_date" };
  if (latestDate(endDate) < earliestDate(startDate)) return { value: null, error: "inverted_date_range" };
  return { value: { startDate, endDate }, error: null };
}

export function parseDateRange(value) {
  return inspectDateRange(value).value;
}
