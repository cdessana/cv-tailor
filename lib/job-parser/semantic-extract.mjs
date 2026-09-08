import { validateCoverage } from "./coverage.mjs";
import { assertExtraction } from "./extraction-contract.mjs";
import { validateEvidence } from "./validate-evidence.mjs";

function mergeMetadata(deterministic, semantic) {
  const merged = { ...(deterministic.metadata ?? {}) };
  for (const [key, value] of Object.entries(semantic.metadata ?? {})) {
    if (merged[key] && semanticText(merged[key].value) !== semanticText(value.value)) {
      const left = semanticText(merged[key].value);
      const right = semanticText(value.value);
      if (!(left.includes(right) || right.includes(left))) throw new Error(`Conflicting semantic metadata: ${key}.`);
      if (right.length <= left.length) continue;
    }
    merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function sameItem(left, right) {
  if (left.type !== right.type || left.kind !== right.kind || left.classification !== right.classification) return false;
  if (left.type === "alternative") {
    return left.operator === right.operator
      && left.values.map(semanticText).sort().join("\u0000") === right.values.map(semanticText).sort().join("\u0000");
  }
  return semanticText(left.value) === semanticText(right.value);
}

function semanticText(value) {
  return String(value).replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/** Run an injected structured provider without candidate data. */
export async function semanticExtract(document, deterministic, provider, { onResponse } = {}) {
  if (!document || typeof document.originalText !== "string") {
    throw new TypeError("Expected a preprocessed job description.");
  }
  const deterministicExtraction = deterministic?.extraction ?? deterministic;
  const unresolved = deterministic?.unresolved ?? [];
  if (!deterministicExtraction || !Array.isArray(deterministicExtraction.items)) {
    throw new TypeError("Expected deterministic extraction items.");
  }
  if (typeof provider !== "function") {
    throw new TypeError("Semantic provider must be a function.");
  }
  const semantic = await provider({
    originalText: document.originalText,
    sections: document.sections,
    unresolved,
  });
  assertExtraction(semantic);
  const evidence = validateEvidence(document, semantic);
  if (!evidence.valid) {
    throw new Error(`Semantic evidence validation failed: ${JSON.stringify(evidence.errors)}`);
  }
  const coverage = validateCoverage(document, semantic);
  if (!coverage.valid) throw new Error(`Semantic coverage validation failed: ${JSON.stringify(coverage.errors)}`);
  const mergedItems = [...deterministicExtraction.items];
  const indexMap = [];
  for (const item of semantic.items) {
    const quote = semanticText(item.evidence.quote);
    const index = mergedItems.findIndex(existing => sameItem(existing, item)
      && (quote.includes(semanticText(existing.evidence.quote)) || semanticText(existing.evidence.quote).includes(quote)));
    if (index < 0) {
      indexMap.push(mergedItems.length);
      mergedItems.push(item);
    } else {
      // Only collapse equivalent values when one quote contains the other.
      // Keep the longer source context; distinct conditions remain distinct.
      if (quote.length > semanticText(mergedItems[index].evidence.quote).length) mergedItems[index] = item;
      indexMap.push(index);
    }
  }
  const merged = { items: mergedItems };
  const metadata = mergeMetadata(deterministicExtraction, semantic);
  if (metadata) merged.metadata = metadata;

  if (semantic.coverage) merged.coverage = semantic.coverage.map(entry => entry.status === "extracted"
    ? { ...entry, itemIndices: [...new Set(entry.itemIndices.map(index => indexMap[index]))] }
    : { ...entry });
  if (merged.coverage) {
    // Account for deterministic items that the provider intentionally did not
    // repeat. Preserve exclusions only where no extraction actually exists.
    const units = new Map(document.sections.flatMap(section => section.units.map(unit => [unit.id, unit])));
    merged.coverage = merged.coverage.map(entry => {
      const text = semanticText(units.get(entry.unitId).originalText);
      const indices = mergedItems.flatMap((item, index) => {
        const quote = semanticText(item.evidence.quote);
        return text.includes(quote) || quote.includes(text) ? [index] : [];
      });
      return indices.length ? { unitId: entry.unitId, status: "extracted", itemIndices: indices, ...(entry.metadataKeys ? { metadataKeys: entry.metadataKeys } : {}) } : entry;
    });
    const mergedCoverage = validateCoverage(document, merged);
    if (!mergedCoverage.valid) throw new Error(`Merged coverage validation failed: ${JSON.stringify(mergedCoverage.errors)}`);
  }
  assertExtraction(merged);
  await onResponse?.(merged);
  return merged;
}
