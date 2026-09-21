import { validateCoverage } from "./coverage.mjs";
import { assertExtraction } from "./extraction-contract.mjs";
import { validateEvidence } from "./validate-evidence.mjs";
import { mergeMetadataRecord } from "./metadata.mjs";
import { consolidateExtraction } from "./consolidate-extraction.mjs";
import { canonicalizeDirectAlternatives } from "./canonicalize-alternatives.mjs";
import { materializeSemanticDecisions } from "./semantic-decisions.mjs";

function mergeMetadata(deterministic, semantic) {
  const merged = { ...(deterministic.metadata ?? {}) };
  for (const [key, value] of Object.entries(semantic.metadata ?? {})) {
    merged[key] = merged[key]
      ? mergeMetadataRecord(merged[key], value, key)
      : structuredClone(value);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function sameItem(left, right) {
  if (
    left.type !== right.type ||
    left.kind !== right.kind ||
    left.classification !== right.classification
  )
    return false;
  if (left.type === "alternative") {
    return (
      left.operator === right.operator &&
      left.values.map(semanticText).sort().join("\u0000") ===
        right.values.map(semanticText).sort().join("\u0000")
    );
  }
  return semanticText(left.value) === semanticText(right.value);
}

function semanticText(value) {
  return String(value).replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/** Run an injected structured provider without candidate data. */
export async function semanticExtract(
  document,
  deterministic,
  provider,
  { onResponse } = {}
) {
  if (!document || typeof document.originalText !== "string") {
    throw new TypeError("Expected a preprocessed job description.");
  }
  const deterministicExtraction = deterministic?.extraction ?? deterministic;
  const unresolved = deterministic?.unresolved ?? [];
  if (
    !deterministicExtraction ||
    !Array.isArray(deterministicExtraction.items)
  ) {
    throw new TypeError("Expected deterministic extraction items.");
  }
  if (typeof provider !== "function") {
    throw new TypeError("Semantic provider must be a function.");
  }
  const sourceSections = document.sections ?? [];
  const unresolvedIds = new Set(
    deterministic?.unresolved === undefined
      ? sourceSections.flatMap((section) =>
          section.units.map((unit) => unit.id)
        )
      : unresolved.map((entry) => entry.unit?.id ?? entry.unitId)
  );
  const semanticSections = sourceSections
    .map((section) => ({
      ...section,
      units: section.units.filter((unit) => unresolvedIds.has(unit.id)),
    }))
    .filter((section) => section.units.length);
  const semanticDocument = {
    originalText: document.originalText,
    sections: semanticSections,
  };
  const response = await provider({
    originalText: document.originalText,
    sections: semanticSections,
    unresolved,
  });
  const providerReport = response?.providerReport;
  // New providers can return narrow source-ID decisions. Legacy providers keep
  // returning the existing extraction shape during the migration.
  const semantic = canonicalizeDirectAlternatives(
    materializeSemanticDecisions(semanticDocument, response) ?? response
  );
  assertExtraction(semantic);
  const evidence = validateEvidence(document, semantic);
  if (!evidence.valid) {
    throw new Error(
      `Semantic evidence validation failed: ${JSON.stringify(evidence.errors)}`
    );
  }
  const coverage = validateCoverage(semanticDocument, semantic);
  if (!coverage.valid)
    throw new Error(
      `Semantic coverage validation failed: ${JSON.stringify(coverage.errors)}`
    );
  const semanticWarnings = (coverage.warnings ?? []).map((warning) => ({
    code: warning.code === "unresolved_unit"
      ? "semantic_unit_unresolved"
      : "semantic_coverage_warning",
    message: warning.message,
    unitId: warning.unitId,
  }));
  const mergedItems = [...deterministicExtraction.items];
  const indexMap = [];
  for (const item of semantic.items) {
    const quote = semanticText(item.evidence.quote);
    const index = mergedItems.findIndex(
      (existing) =>
        sameItem(existing, item) &&
        (quote.includes(semanticText(existing.evidence.quote)) ||
          semanticText(existing.evidence.quote).includes(quote))
    );
    if (index < 0) {
      indexMap.push(mergedItems.length);
      mergedItems.push(item);
    } else {
      // Only collapse equivalent values when one quote contains the other.
      // Keep the longer source context; distinct conditions remain distinct.
      const existing = mergedItems[index];
      const kept = structuredClone(
        quote.length > semanticText(existing.evidence.quote).length
          ? item
          : existing
      );
      // Both quotes fit the retained context. Preserve examples from either
      // record instead of discarding information during duplicate removal.
      if (existing.examples || item.examples) {
        kept.examples = [
          ...new Map(
            [...(existing.examples ?? []), ...(item.examples ?? [])].map(
              (example) => [
                semanticText(example.value),
                structuredClone(example),
              ]
            )
          ).values(),
        ];
      }
      mergedItems[index] = kept;
      indexMap.push(index);
    }
  }
  const merged = { items: mergedItems };
  const metadata = mergeMetadata(deterministicExtraction, semantic);
  if (metadata) merged.metadata = metadata;

  if (semantic.coverage)
    merged.coverage = semantic.coverage.map((entry) =>
      entry.status === "extracted"
        ? {
            ...entry,
            itemIndices: [
              ...new Set(entry.itemIndices.map((index) => indexMap[index])),
            ],
          }
        : { ...entry }
    );
  if (merged.coverage) {
    // Account for deterministic items that the provider intentionally did not
    // repeat. Preserve exclusions only where no extraction actually exists.
    const units = new Map(
      document.sections.flatMap((section) =>
        section.units.map((unit) => [unit.id, unit])
      )
    );
    merged.coverage = merged.coverage.map((entry) => {
      const text = semanticText(units.get(entry.unitId).originalText);
      const indices = mergedItems.flatMap((item, index) => {
        const quote = semanticText(item.evidence.quote);
        return text.includes(quote) || quote.includes(text) ? [index] : [];
      });
      return indices.length
        ? {
            unitId: entry.unitId,
            status: "extracted",
            itemIndices: indices,
            ...(entry.metadataKeys ? { metadataKeys: entry.metadataKeys } : {}),
          }
        : entry;
    });
    for (const [unitId, unit] of units) {
      if (unresolvedIds.has(unitId)) continue;
      const text = semanticText(unit.originalText);
      const itemIndices = mergedItems.flatMap((item, index) => {
        const quote = semanticText(item.evidence.quote);
        return text.includes(quote) || quote.includes(text) ? [index] : [];
      });
      const metadataKeys = Object.entries(merged.metadata ?? {}).flatMap(
        ([key, record]) => {
          const quote = semanticText(record.evidence.quote);
          return text.includes(quote) || quote.includes(text) ? [key] : [];
        }
      );
      if (itemIndices.length) {
        merged.coverage.push({
          unitId,
          status: "extracted",
          itemIndices,
          ...(metadataKeys.length ? { metadataKeys } : {}),
        });
      } else if (metadataKeys.length) {
        merged.coverage.push({ unitId, status: "metadata", metadataKeys });
      } else {
        const deterministicDecision = deterministicExtraction.coverage?.find(
          (entry) => entry.unitId === unitId
        );
        if (deterministicDecision)
          merged.coverage.push(structuredClone(deterministicDecision));
      }
    }
    const unitOrder = new Map(
      [...units.keys()].map((unitId, index) => [unitId, index])
    );
    merged.coverage.sort(
      (left, right) => unitOrder.get(left.unitId) - unitOrder.get(right.unitId)
    );
    const mergedCoverage = validateCoverage(document, merged);
    if (!mergedCoverage.valid)
      throw new Error(
        `Merged coverage validation failed: ${JSON.stringify(mergedCoverage.errors)}`
      );
    semanticWarnings.push(
      ...(mergedCoverage.warnings ?? []).map((warning) => ({
        code: warning.code === "unresolved_unit"
          ? "semantic_unit_unresolved"
          : "semantic_coverage_warning",
        message: warning.message,
        unitId: warning.unitId,
      }))
    );
  }
  const consolidated = consolidateExtraction(document, merged);
  if (providerReport) {
    Object.defineProperty(consolidated, "providerReport", {
      value: structuredClone(providerReport),
      enumerable: false,
    });
  }
  if (semanticWarnings.length) {
    Object.defineProperty(consolidated, "semanticWarnings", {
      value: [
        ...new Map(
          semanticWarnings.map((warning) => [
            `${warning.code}\u0000${warning.unitId}\u0000${warning.message}`,
            warning,
          ])
        ).values(),
      ],
      enumerable: false,
    });
  }
  await onResponse?.(consolidated);
  return consolidated;
}
