function normalized(value) {
  return String(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

export function createProvenanceResolver(lines) {
  const consumed = new Set();
  return (value) => {
    if (!value || typeof value !== "string") return null;
    const target = normalized(value);
    const index = lines.findIndex((line, candidate) => !consumed.has(candidate) && normalized(line.text) === target);
    const fallback = index < 0 ? lines.findIndex((line, candidate) => !consumed.has(candidate) && normalized(line.text).includes(target)) : index;
    if (fallback < 0) return null;
    consumed.add(fallback);
    return lines[fallback].source;
  };
}
