import { assertExtraction } from "./extraction-contract.mjs";

const text = value => String(value).replace(/\s+/gu, " ").trim().toLocaleLowerCase();

function key(item) {
  const identity = item.type === "alternative"
    ? `${item.operator}\u0000${[...item.values].map(text).sort().join("\u0000")}`
    : text(item.value);
  return `${item.type}\u0000${item.kind}\u0000${item.classification}\u0000${identity}\u0000${text(item.evidence.quote)}`;
}

function sectionByUnit(document) {
  return new Map((document.sections ?? []).flatMap((section, index) => section.units.map(unit => [unit.id, index])));
}

function sameSection(left, right, sections) {
  const leftSections = new Set((left.sourceUnitIds ?? []).map(id => sections.get(id)).filter(index => index !== undefined));
  return leftSections.size > 0 && (right.sourceUnitIds ?? []).some(id => leftSections.has(sections.get(id)));
}

function mergeExamples(left, right) {
  if (!left.examples && !right.examples) return undefined;
  return [...new Map([...(left.examples ?? []), ...(right.examples ?? [])]
    .map(example => [text(example.value), structuredClone(example)])).values()];
}

/** Consolidate exact repeated records within one source section only.
 * It intentionally avoids semantic equivalence, paraphrase and cross-section
 * deduplication because those can discard durations, scope and conditions.
 */
export function consolidateExtraction(document, extraction) {
  assertExtraction(extraction);
  const sections = sectionByUnit(document);
  const result = structuredClone(extraction);
  const items = [];
  const indexMap = [];
  const byKey = new Map();
  result.items.forEach((item, index) => {
    const existingIndex = byKey.get(key(item));
    const existing = existingIndex === undefined ? undefined : items[existingIndex];
    if (!existing || !sameSection(existing, item, sections)) {
      indexMap[index] = items.length;
      items.push(item);
      byKey.set(key(item), items.length - 1);
      return;
    }
    existing.sourceUnitIds = [...new Set([...(existing.sourceUnitIds ?? []), ...(item.sourceUnitIds ?? [])])];
    const examples = mergeExamples(existing, item);
    if (examples) existing.examples = examples;
    indexMap[index] = existingIndex;
  });
  result.items = items;
  if (result.coverage) {
    result.coverage = result.coverage.map(entry => entry.status === "extracted"
      ? { ...entry, itemIndices: [...new Set(entry.itemIndices.map(index => indexMap[index]))] }
      : entry);
  }
  assertExtraction(result);
  return result;
}
