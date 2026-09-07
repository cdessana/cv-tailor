import { assertExtraction } from "./extraction-contract.mjs";
import { validateEvidence } from "./validate-evidence.mjs";

function mergeMetadata(deterministic, semantic) {
  const merged = { ...(deterministic.metadata ?? {}) };
  for (const [key, value] of Object.entries(semantic.metadata ?? {})) {
    if (merged[key] && semanticText(merged[key].value) !== semanticText(value.value)) {
      throw new Error(`Conflicting semantic metadata: ${key}.`);
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
  await onResponse?.(merged);
  return merged;
}
