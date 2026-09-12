import { assertExtraction } from "./extraction-contract.mjs";

const text = value => String(value).replace(/\s+/gu, " ").trim().toLocaleLowerCase();
const duration = value => text(value).match(/\b(?:at\s+least|minimum\s+of|mais\s+de)?\s*(\d+)\s*\+?\s*(?:years?|anos?)\b/iu)?.[1];
const filler = new Set("at least minimum of years year anos ano experience experiencia experiência in with using backend development desenvolvimento software engineering engineer engenheiro de para com em de".split(" "));

function anchors(value) {
  return new Set(text(value).match(/[\p{L}\p{N}+#.]+/gu)?.filter(token => token.length > 2 && !filler.has(token)) ?? []);
}

function detailedDuplicate(left, right) {
  if (left.type !== "item" || right.type !== "item" || left.kind !== right.kind
    || left.classification !== right.classification || !["skill", "requirement"].includes(left.kind)) return false;
  const leftDuration = duration(left.value), rightDuration = duration(right.value);
  if (!leftDuration || leftDuration !== rightDuration) return false;
  const rightAnchors = anchors(right.value);
  return [...anchors(left.value)].some(token => rightAnchors.has(token));
}

function detailScore(item) {
  return anchors(item.value).size * 1000 + text(item.value).length;
}

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

/** Consolidate exact repeated records and a narrow duration-plus-technology
 * duplicate. The latter is intentionally limited to identical minimum years,
 * kind and classification, so nearby but distinct qualifications stay intact.
 */
export function consolidateExtraction(document, extraction) {
  assertExtraction(extraction);
  const sections = sectionByUnit(document);
  const providerReport = extraction.providerReport;
  const result = structuredClone(extraction);
  const items = [];
  const indexMap = [];
  const byKey = new Map();
  result.items.forEach((item, index) => {
    const existingIndex = byKey.get(key(item));
    const exact = existingIndex === undefined ? undefined : items[existingIndex];
    const semanticIndex = exact ? undefined : items.findIndex(existing => detailedDuplicate(existing, item));
    const duplicateIndex = exact && sameSection(exact, item, sections) ? existingIndex : semanticIndex;
    const existing = duplicateIndex === undefined || duplicateIndex < 0 ? undefined : items[duplicateIndex];
    if (!existing) {
      indexMap[index] = items.length;
      items.push(item);
      byKey.set(key(item), items.length - 1);
      return;
    }
    const retained = detailScore(item) > detailScore(existing) ? structuredClone(item) : existing;
    retained.sourceUnitIds = [...new Set([...(existing.sourceUnitIds ?? []), ...(item.sourceUnitIds ?? [])])];
    const examples = mergeExamples(existing, item);
    if (examples) retained.examples = examples;
    items[duplicateIndex] = retained;
    indexMap[index] = duplicateIndex;
  });
  result.items = items;
  if (providerReport) {
    Object.defineProperty(result, "providerReport", {
      value: structuredClone(providerReport),
      enumerable: false,
    });
  }
  if (result.coverage) {
    result.coverage = result.coverage.map(entry => entry.status === "extracted"
      ? { ...entry, itemIndices: [...new Set(entry.itemIndices.map(index => indexMap[index]))] }
      : entry);
  }
  assertExtraction(result);
  return result;
}
