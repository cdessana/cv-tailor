import { aliasComparisonKey, validateParserAliases } from "./validate-aliases.mjs";
import { assertExtraction, defaultAliases } from "./extraction-contract.mjs";

function normalized(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function valueMatch(source, value, ignoreCase = false) {
  const haystack = normalized(source);
  const needle = normalized(value);
  if (!needle) return null;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const leadingTokenSymbol = "[+#.-]";
  const trailingTokenSymbol = "[+#]";
  const tokenCharacter = "[\\p{L}\\p{N}_]";
  return new RegExp(
    `(?<!${tokenCharacter})(?<!${leadingTokenSymbol})${escaped}`
      + `(?!${tokenCharacter})(?!${trailingTokenSymbol}|[.-]${tokenCharacter})`,
    ignoreCase ? "iu" : "u",
  ).exec(haystack);
}

const contains = (source, value) => valueMatch(source, value) !== null;

// Quotes are literal excerpts, not technology tokens. Scraped page text can
// concatenate a label with its preceding text (e.g. AssuranceRemote, Brazil).
function containsQuote(source, quote) {
  return Boolean(normalized(quote)) && normalized(source).includes(normalized(quote));
}

/** Restore casing only; keep word/symbol boundaries and do not rewrite words. */
export function restoreSourceCase(value, quote) {
  if (contains(quote, value)) return value;
  const match = valueMatch(quote, value, true);
  return match && normalized(match[0]).toLowerCase() === normalized(value).toLowerCase() ? match[0] : value;
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
    if (!valueSupported(value, quote, dictionary, index) || !valueSupported(value, document.originalText, dictionary, index)) {
      errors.push(issue("value_not_supported_by_evidence", path,
        "Extracted value is not supported by its source evidence.", { value, quote }));
    }
  };
  for (const [key, metadata] of Object.entries(extraction.metadata ?? {})) {
    const records = [{ record: metadata, path: `/metadata/${key}` }, ...(metadata.candidates ?? []).map((record, i) => ({ record, path: `/metadata/${key}/candidates/${i}` }))];
    for (const { record, path } of records) {
    const quote = record.evidence.quote;
    if (key === "employmentType" && /^(?:100%\s*)?(?:remote(?:\s+work)?|hybrid|on[ -]?site|remoto|remota|híbrido|híbrida|presencial)$/iu.test(record.value.trim())) {
      errors.push(issue("invalid_employment_type", `${path}/value`, "Work arrangement is not an employment type.", { value: record.value }));
    }
    if (!containsQuote(document.originalText, quote)) {
      errors.push(issue("evidence_not_found", `${path}/evidence/quote`,
        "Evidence quote not present in source.", { quote }));
      continue;
    }
    if (!valueSupported(record.value, quote, dictionary, index) || !valueSupported(record.value, document.originalText, dictionary, index)) {
      errors.push(issue("value_not_supported_by_evidence", `${path}/value`,
        `Extracted ${key} is not supported by its source evidence.`, { value: record.value, quote }));
    }
    }
  }
  extraction.items.forEach((item, itemIndex) => {
    const path = `/items/${itemIndex}`;
    const quote = item.evidence.quote;
    const sourceSections = (document.sections ?? []).filter(section => section.units.some(unit => normalized(unit.originalText).includes(normalized(quote))));
    if (item.classification === "required" && sourceSections.length && sourceSections.every(section => /(?:tech(?:nology)? stack|stack tecnológic[oa])/iu.test(section.heading?.text ?? ""))) {
      errors.push(issue("stack_not_requirement", path, "A stack listing alone does not establish a required candidate qualification.", { quote }));
    }
    if (!containsQuote(document.originalText, quote)) {
      errors.push(issue("evidence_not_found", `${path}/evidence/quote`,
        "Evidence quote not present in source.", { quote }));
      return;
    }
    if (item.type === "item") {
      checkValue(item.value, quote, `${path}/value`);
      for (const [index, example] of (item.examples ?? []).entries()) {
        checkValue(example.value, quote, `${path}/examples/${index}/value`);
      }
      return;
    }
    item.values.forEach((value, valueIndex) => {
      checkValue(value, quote, `${path}/values/${valueIndex}`);
    });
  });
  return { valid: errors.length === 0, errors };
}
