import { assertExtraction } from "./extraction-contract.mjs";

function sourceContains(document, quote) {
  return typeof quote === "string" && quote.length > 0 && document.originalText.includes(quote);
}

function validateEvidence(document, extraction) {
  for (const [key, value] of Object.entries(extraction.metadata ?? {})) {
    if (!sourceContains(document, value.evidence.quote)) {
      throw new Error(`Semantic evidence for metadata.${key} is not present in source.`);
    }
  }
  for (const item of extraction.items) {
    if (!sourceContains(document, item.evidence.quote)) {
      throw new Error("Semantic item evidence is not present in source.");
    }
  }
}

function mergeMetadata(deterministic, semantic) {
  const merged = { ...(deterministic.metadata ?? {}) };
  for (const [key, value] of Object.entries(semantic.metadata ?? {})) {
    if (merged[key] && JSON.stringify(merged[key]) !== JSON.stringify(value)) {
      throw new Error(`Conflicting semantic metadata: ${key}.`);
    }
    merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function sameItem(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Run an injected structured provider without candidate data. */
export async function semanticExtract(document, deterministic, provider) {
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
  validateEvidence(document, semantic);
  const mergedItems = [...deterministicExtraction.items];
  for (const item of semantic.items) {
    if (!mergedItems.some((existing) => sameItem(existing, item))) {
      mergedItems.push(item);
    }
  }
  const merged = { items: mergedItems };
  const metadata = mergeMetadata(deterministicExtraction, semantic);
  if (metadata) merged.metadata = metadata;
  assertExtraction(merged);
  return merged;
}
