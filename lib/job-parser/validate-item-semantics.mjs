import { isDescriptiveOr, validateAlternativeSemantics } from "../job-requirements/alternatives.mjs";
import { validateExampleCoverage } from "./example-coverage.mjs";
import { defaultAliases } from "./extraction-contract.mjs";

const normalize = value => value.replace(/\s+/gu, " ").trim().toLowerCase();
const examplePattern = /\(\s*(?:such as|e\.g\.|i\.e\.|for example|ex|como|por exemplo|incluindo|including|like)(?::|(?![a-z0-9]))[^()]*\)/giu;
const trailingIllustration = /(?:,\s*)?\b(?:like|such as|e\.g\.|for example|como|por exemplo|principalmente|especially|incluindo|including|tais como|entre el(?:e|a)s)\b[\s\S]*$/iu;
const choice = /\b(?:or|ou)\b/iu;
const broadCategoryOr = /\b(?:platforms?|frameworks?|tools?|languages?|technologies|systems|solutions|methods|approaches|components?|services?|applications?|apis?|features?|modules?|tasks?|processes?|fields?|disciplines?|degrees?|areas?)\s+(?:or|ou)\s+(?:(?:connector|backend|frontend|integration|cloud|data|automation)\s+)?(?:platforms?|frameworks?|tools?|languages?|technologies|systems|solutions|methods|approaches|components?|services?|applications?|apis?|features?|modules?|tasks?|processes?|fields?|disciplines?|degrees?|areas?)\b|(?:\b[\p{L}\p{N} ]+\s+(?:or|ou)\s+(?:a\s+related\s+field|uma\s+área\s+relacionada)\b)/iu;

function optionPosition(text, value) {
  const canonical = Object.keys(defaultAliases).find(key => [key, ...defaultAliases[key]].some(alias => normalize(alias) === normalize(value)));
  const spellings = canonical ? [value, canonical, ...defaultAliases[canonical]] : [value];
  const matches = spellings.flatMap(spelling => {
    const escaped = normalize(spelling).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u").exec(text);
    return match ? [{ start: match.index, end: match.index + match[0].length }] : [];
  });
  return matches.sort((a, b) => a.start - b.start)[0];
}

/** Pure, bounded checks shared by provider correction and final mapping.
 * Structural validity and source grounding are checked separately.
 */
export function validateItemSemantics(item, { metadata = {} } = {}) {
  const errors = [];
  const add = (code, message, instruction) => errors.push({ code, path: "", message, instruction,
    value: item.value, values: item.values, classification: item.classification, quote: item.evidence.quote });
  const quote = item.evidence.quote;
  const qualification = ["skill", "requirement", "competency"].includes(item.kind);
  if (qualification) {
    if (item.type === "item" && /^(?:estamos em busca de|we(?:'re| are) (?:looking|hiring) (?:for)?|seeking)\b/iu.test(quote.trim())) {
      add("job_title_as_requirement", "A sentence announcing the open role was classified as a candidate requirement.",
        "Extract the role as title metadata when needed. Do not create a candidate requirement unless the source states a qualification, experience, years, skill, or responsibility.");
    }
    for (const [key, primary] of Object.entries(metadata).filter(([key]) => !["company", "title"].includes(key))) {
      const records = [primary, ...(primary.candidates ?? [])];
      if (item.type === "item" && records.some(record => normalize(record.value) === normalize(item.value)
        && normalize(record.evidence.quote) === normalize(quote))) {
        add("metadata_as_requirement", "Source-backed metadata is repeated as a candidate requirement.",
          `Keep this source-backed ${key} in metadata only. Do not remove actual experience requirements about a role.`);
      }
    }
    for (const key of ["company", "title"]) {
      const records = metadata[key] ? [metadata[key], ...(metadata[key].candidates ?? [])] : [];
      if (item.type === "item" && records.some(record => normalize(record.value) === normalize(item.value)
        && (normalize(record.evidence.quote) === normalize(quote)
          || (/^(?:estamos em busca de|we are hiring|we are looking for)\b/iu.test(quote.trim())
            && normalize(quote).includes(normalize(record.evidence.quote)))))) {
        add("metadata_as_requirement", "Identification metadata is repeated as a candidate requirement.",
          "Keep this source-backed company/title in metadata only. Do not remove actual experience requirements about a role.");
      }
    }
    if (/^(?:no backend,?\s+utilizamos|nosso desenvolvimento é|(?:our|the)\s+(?:main\s+)?stack\s+(?:is|includes|uses)|we use)\b/iu.test(quote.trim())) {
      add("context_not_qualification", "A description of the company's stack does not establish a candidate qualification.",
        "Use an explicit candidate qualification from this block if available; otherwise exclude company context. Do not label stack context preferred by default.");
    }
  }
  if (item.type === "alternative") {
    try {
      for (const match of quote.matchAll(/\b(?:like|such as|e\.g\.|for example|como|por exemplo)\s*,?\s*([^;!?]+)/giu)) {
        if (item.values.every(value => optionPosition(normalize(match[1]), value))) {
          throw new TypeError("Example technologies cannot replace the broader qualification.");
        }
      }
      validateAlternativeSemantics({ ...item, context: quote });
      const context = normalize(quote);
      const positions = item.values.map(value => optionPosition(context, value));
      if (positions.every(Boolean)) {
        positions.sort((a, b) => a.start - b.start);
        const between = context.slice(positions[0].end, positions.at(-1).start);
        const prefix = context.slice(0, positions[0].start);
        if (!choice.test(between) && !/\b(?:one of|either|at least one|one or more)\s*[:,-]?\s*$/iu.test(prefix)) {
          throw new TypeError("The choice signal does not connect these options; preserve the complete qualification and its conjunctions.");
        }
      }
    } catch (error) {
      add("invalid_alternative", error.message,
        "Copy the complete qualification as an ordinary item for AND lists or illustrations. Use anyOf only for options actually linked by a choice. Preserve all qualifiers and examples; never discard the requirement.");
    }
    if (!["required", "preferred"].includes(item.classification) || item.kind === "responsibility") {
      add("unsupported_alternative", "Alternative classification cannot be represented safely.", "Preserve source classification; do not promote ambiguity to required.");
    }
  } else {
    const remaining = item.value.replace(examplePattern, "").replace(trailingIllustration, "")
      .replace(/\b\d+(?:[.,]\d+)?\s+(?:or\s+more|ou\s+mais)\b/giu, "")
      .replace(/\bone\s+or\s+more\b/giu, "")
      .replace(/\b(?:or|ou)\s+(?:higher|superior|equivalent|equivalente|else|demais)\b/giu, "")
      .replace(/\bconhecimento\s+ou\s+interesse\s+em\b/giu, "conhecimento/interesse em");
    // A complete source-grounded structural item can retain an unresolved OR
    // expression without claiming anyOf. Partial/decomposed alternatives stay
    // subject to the existing safeguard.
    const preservesCompleteQuote =
      item.sourceUnitIds?.length > 0 &&
      normalize(item.value) ===
        normalize(quote).replace(/^(?:[-*+•◦▪]|\d+[.)])\s*/u, "");
    if (
      qualification &&
      choice.test(remaining) &&
      !isDescriptiveOr(remaining) &&
      !broadCategoryOr.test(remaining) &&
      !preservesCompleteQuote
    ) {
      add("unstructured_alternative", "Possible OR expression must be represented as a group or resolved conservatively.",
        "Keep illustrations separate from real choices. Preserve shared qualifiers and the relationship between the actual options.");
    }
    errors.push(...validateExampleCoverage(item));
  }
  return errors;
}
