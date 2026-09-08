const normalize = text => text.replace(/\s+/gu, " ").trim().toLowerCase();

/** Check only simple, explicitly marked parenthetical lists attached to value.
 * This is a bounded omission check, not a general semantic completeness test.
 */
export function validateExampleCoverage(item) {
  if (item.type !== "item" || !["skill", "requirement", "competency"].includes(item.kind)
    || !["required", "preferred"].includes(item.classification)) return [];
  const quote = item.evidence.quote;
  const errors = [];
  for (const match of quote.matchAll(/\(\s*(?:such as\s+|e\.g\.\s*,?\s*|for example\s*,?\s*|como\s+|por exemplo\s*,?\s*)([^()]+)\)/giu)) {
    // An unrelated illustration elsewhere in a long quote does not belong to
    // this item. A list already retained in value has not been omitted either.
    if (!normalize(quote.slice(0, match.index)).endsWith(normalize(item.value))) continue;
    const values = match[1].split(/\s*,\s*(?:(?:and|or|e|ou)\s+)?|\s+(?:and|or|e|ou)\s+/iu).map(value => value.trim());
    // Leave prose, nested lists and qualified expressions to semantic review.
    if (values.some(value => !/^[\p{L}\p{N}][\p{L}\p{N}+#.\/-]*(?:[ -][\p{L}\p{N}][\p{L}\p{N}+#.\/-]*){0,2}$/u.test(value))) continue;
    const present = new Set((item.examples ?? []).map(example => normalize(example.value)));
    const missing = values.filter(value => !present.has(normalize(value)));
    if (missing.length) errors.push({
      code: "missing_examples", path: "/examples", missing, quote,
      message: "Explicit examples attached to this qualification are missing.",
      instruction: "Preserve the broader value and add each missing source spelling to examples as {value}. Do not create independent requirements or anyOf alternatives, and do not remove the evidence list.",
    });
  }
  return errors;
}
