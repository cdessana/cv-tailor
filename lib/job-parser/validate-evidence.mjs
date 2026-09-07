import { aliasComparisonKey, validateParserAliases } from "./validate-aliases.mjs";
import { assertExtraction, defaultAliases } from "./extraction-contract.mjs";

function normalized(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function contains(source, value) {
  return source.includes(value) || normalized(source).includes(normalized(value));
}

function aliasIndex(dictionary) {
  const result = validateParserAliases(dictionary);
  if (!result.valid) throw new TypeError(`Invalid parser aliases: ${JSON.stringify(result.errors)}`);
  const index = new Map();
  for (const [canonical, aliases] of Object.entries(dictionary)) {
    for (const value of [canonical, ...aliases]) index.set(aliasComparisonKey(value), canonical);
  }
  return index;
}

function valueSupported(value, quote, dictionary, index) {
  if (contains(quote, value)) return true;
  const canonical = index.get(aliasComparisonKey(value));
  if (!canonical) return false;
  const spellings = [canonical, ...(dictionary[canonical] ?? [])];
  return spellings.some((spelling) => contains(quote, spelling));
}

function issue(code, path, message, details = {}) {
  return { code, path, message, ...details };
}

/** Validate that schema-valid extraction values and evidence are source-grounded. */
export function validateEvidence(document, extraction, dictionary = defaultAliases) {
  if (!document || typeof document.originalText !== "string") {
    throw new TypeError("Expected a source document.");
  }
  assertExtraction(extraction);
  const index = aliasIndex(dictionary);
  const errors = [];
  const checkValue = (value, quote, path) => {
    if (!valueSupported(value, quote, dictionary, index)) {
      errors.push(issue("value_not_supported_by_evidence", path,
        "Extracted value is not supported by its source evidence.", { value, quote }));
    }
  };
  for (const [key, metadata] of Object.entries(extraction.metadata ?? {})) {
    const path = `/metadata/${key}`;
    const quote = metadata.evidence.quote;
    if (!contains(document.originalText, quote)) {
      errors.push(issue("evidence_not_found", `${path}/evidence/quote`,
        "Evidence quote not present in source.", { quote }));
      continue;
    }
  }
  extraction.items.forEach((item, itemIndex) => {
    const path = `/items/${itemIndex}`;
    const quote = item.evidence.quote;
    if (!contains(document.originalText, quote)) {
      errors.push(issue("evidence_not_found", `${path}/evidence/quote`,
        "Evidence quote not present in source.", { quote }));
      return;
    }
    if (item.type === "item") {
      if (item.kind === "skill" || item.kind === "requirement") {
        checkValue(item.value, quote, `${path}/value`);
      }
      return;
    }
    item.values.forEach((value, valueIndex) => {
      checkValue(value, quote, `${path}/values/${valueIndex}`);
    });
  });
  return { valid: errors.length === 0, errors };
}
