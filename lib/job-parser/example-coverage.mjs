import { defaultAliases } from "./extraction-contract.mjs";

const normalize = text => text.replace(/\s+/gu, " ").trim().toLowerCase();
const aliases = new Map(Object.entries(defaultAliases).flatMap(([canonical, values]) =>
  [canonical, ...values].map(value => [normalize(value), normalize(canonical)])));
const key = value => aliases.get(normalize(value)) ?? normalize(value);

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
    if (values.some(value => !/^[\p{L}\p{N}][\p{L}\p{N}+#./-]*(?:[ -][\p{L}\p{N}][\p{L}\p{N}+#./-]*){0,2}$/u.test(value))) continue;
    const present = new Set((item.examples ?? []).map(example => key(example.value)));
    const missing = values.filter(value => !present.has(key(value)));
    if (missing.length) errors.push({
      code: "missing_examples", path: "/examples", missing, quote,
      message: "Explicit examples attached to this qualification are missing.",
      instruction: "Preserve the broader value and add each missing source spelling to examples as {value}. Do not create independent requirements or anyOf alternatives, and do not remove the evidence list.",
    });
  }
  for (const match of quote.matchAll(/\(([^()]+)\)/gu)) {
    if (/^(?:such as\b|e\.g\.|for example\b|como\b|por exemplo\b)/iu.test(match[1].trim())) continue;
    if (!normalize(quote.slice(0, match.index)).endsWith(normalize(item.value))) continue;
    const values = match[1].split(/\s*,\s*/u);
    if (values.length < 2 || values.some(value => !/^[\p{L}\p{N}][\p{L}\p{N}+#./-]*(?:[ -][\p{L}\p{N}][\p{L}\p{N}+#./-]*){0,2}$/u.test(value))) continue;
    errors.push({ code: "missing_qualification_details", path: "/value", quote,
      message: "A parenthetical list attached to the qualification was omitted from its value.",
      instruction: "Copy the complete qualification including the parentheses. Without an explicit example or choice marker, do not assume optional examples or anyOf semantics.",
    });
  }
  return errors;
}
