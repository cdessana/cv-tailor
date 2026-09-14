export function extractedEntry(value, sources) {
  return { value, sources };
}

export function provenanceForEntry(path, sources) {
  const entries = [];
  for (const [field, source] of Object.entries(sources)) {
    if (Array.isArray(source)) source.forEach((item, index) => entries.push({ path: `${path}/${field}/${index}`, source: item }));
    else if (source) entries.push({ path: `${path}/${field}`, source });
  }
  return entries;
}
