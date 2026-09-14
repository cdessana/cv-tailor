const months = new Map([
  ["jan", "01"], ["january", "01"], ["janeiro", "01"], ["feb", "02"], ["february", "02"], ["fevereiro", "02"], ["mar", "03"], ["march", "03"], ["março", "03"], ["apr", "04"], ["april", "04"], ["abril", "04"], ["may", "05"], ["maio", "05"], ["jun", "06"], ["june", "06"], ["junho", "06"], ["jul", "07"], ["july", "07"], ["julho", "07"], ["aug", "08"], ["august", "08"], ["agosto", "08"], ["sep", "09"], ["september", "09"], ["setembro", "09"], ["oct", "10"], ["october", "10"], ["outubro", "10"], ["nov", "11"], ["november", "11"], ["novembro", "11"], ["dec", "12"], ["december", "12"], ["dezembro", "12"],
]);

function normalizeDate(value) {
  const text = value.trim().toLowerCase().replace(/\.$/u, "");
  if (/^(19|20)\d{2}$/u.test(text)) return text;
  if (/^(0[1-9]|1[0-2])\/(19|20)\d{2}$/u.test(text)) return `${text.slice(3)}-${text.slice(0, 2)}`;
  if (/^(19|20)\d{2}-(0[1-9]|1[0-2])$/u.test(text)) return text;
  const match = text.match(/^([a-zç]+)\s+(19|20\d{2}|20\d{2})$/u);
  return match && months.has(match[1]) ? `${match[2]}-${months.get(match[1])}` : null;
}

export function parseDateRange(value) {
  const parts = value.split(/\s+(?:-|–|—|to|até|a)\s+/iu).filter(Boolean);
  const startDate = normalizeDate(parts[0] ?? "");
  if (!startDate) return null;
  const end = parts[1]?.trim();
  if (!end || /^(present|current|atual)$/iu.test(end)) return { startDate };
  const endDate = normalizeDate(end);
  if (!endDate || endDate < startDate) return null;
  return { startDate, endDate };
}
