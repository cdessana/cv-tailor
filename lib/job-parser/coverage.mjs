import { assertExtraction } from "./extraction-contract.mjs";

const normalize = text => text.replace(/\s+/gu, " ").trim().toLowerCase();

/** Check accounting references, not semantic completeness within each unit. */
export function validateCoverage(document, extraction, { required = false } = {}) {
  assertExtraction(extraction);
  const errors = [];
  const add = (code, message, details = {}) => errors.push({ code, message, ...details });
  if (!extraction.coverage) {
    if (required) add("missing_coverage", "Semantic provider must account for every source unit.");
    return { valid: !errors.length, errors };
  }
  const units = new Map((document.sections ?? []).flatMap(section => section.units.map(unit => [unit.id, unit])));
  const seen = new Set();
  const referenced = new Set();
  for (const entry of extraction.coverage) {
    const unit = units.get(entry.unitId);
    if (!unit) { add("unknown_unit", "Coverage references an unknown source unit.", { unitId: entry.unitId }); continue; }
    if (seen.has(entry.unitId)) add("duplicate_unit", "Source unit accounted for more than once.", { unitId: entry.unitId });
    seen.add(entry.unitId);
    if (entry.status === "unresolved") add("unresolved_unit", entry.reason, { unitId: entry.unitId });
    for (const key of entry.metadataKeys ?? []) {
      const record = extraction.metadata?.[key];
      if (!record) { add("invalid_metadata_reference", "Coverage references missing metadata.", { unitId: entry.unitId, key }); continue; }
      const quote = normalize(record.evidence.quote), text = normalize(unit.originalText);
      if (!text.includes(quote) && !quote.includes(text)) add("unrelated_metadata_reference", "Metadata evidence is unrelated to source unit.", { unitId: entry.unitId, key });
    }
    if (entry.status !== "extracted") continue;
    for (const index of entry.itemIndices) {
      const item = extraction.items[index];
      if (!item) { add("invalid_item_reference", "Coverage references a nonexistent item.", { unitId: entry.unitId, index }); continue; }
      const quote = normalize(item.evidence.quote);
      const text = normalize(unit.originalText);
      if (!text.includes(quote) && !quote.includes(text)) {
        add("unrelated_item_reference", "Item evidence does not correspond to the referenced source unit.", { unitId: entry.unitId, index });
      } else referenced.add(index);
    }
  }
  for (const id of units.keys()) if (!seen.has(id)) add("unaccounted_unit", "Source unit has no coverage decision.", { unitId: id });
  extraction.items.forEach((_, index) => { if (!referenced.has(index)) add("unaccounted_item", "Extracted item has no source-unit reference.", { index }); });
  return { valid: !errors.length, errors };
}

/** Derive index accounting from provider source references without guessing them. */
export function deriveCoverage(document, extraction) {
  assertExtraction(extraction);
  const units = new Map((document.sections ?? []).flatMap(section => section.units.map(unit => [unit.id, unit])));
  const decisions = new Map();
  const errors = [];
  const add = (code, message, details = {}) => errors.push({ code, message, ...details });
  if (!extraction.coverage) add("missing_coverage", "Provider must include coverage (an empty array when all units have records).");
  for (const decision of extraction.coverage ?? []) {
    if (!["excluded", "unresolved"].includes(decision.status)) {
      add("model_generated_indexes", "Provider must reference source IDs on records, not send extracted/metadata coverage decisions.");
      continue;
    }
    if (!units.has(decision.unitId)) add("unknown_unit", "Unknown source unit.", { unitId: decision.unitId });
    if (decisions.has(decision.unitId)) add("duplicate_unit", "Duplicate source decision.", { unitId: decision.unitId });
    decisions.set(decision.unitId, decision);
  }
  const links = new Map();
  function link(record, key, index) {
    if (!record.sourceUnitIds?.length) {
      add("missing_source_reference", "Each provider item and metadata value needs sourceUnitIds.", { key, index });
      return;
    }
    for (const unitId of record.sourceUnitIds) {
      const unit = units.get(unitId);
      if (!unit) { add("unknown_unit", "Unknown source unit.", { unitId, key, index }); continue; }
      const quote = normalize(record.evidence.quote), text = normalize(unit.originalText);
      if (!text.includes(quote) && !quote.includes(text)) {
        add("unrelated_source_reference", "Source reference does not support record evidence.", { unitId, key, index }); continue;
      }
      if (decisions.has(unitId)) add("conflicting_decision", "An extracted source unit cannot also be excluded or unresolved.", { unitId });
      const entry = links.get(unitId) ?? { itemIndices: [], metadataKeys: [] };
      if (key !== undefined) entry.metadataKeys.push(key);
      else entry.itemIndices.push(index);
      links.set(unitId, entry);
    }
  }
  extraction.items.forEach((record, index) => link(record, undefined, index));
  for (const [key, record] of Object.entries(extraction.metadata ?? {})) link(record, key);
  const coverage = [];
  for (const unitId of units.keys()) {
    const linked = links.get(unitId);
    if (linked) {
      const entry = { unitId, status: linked.itemIndices.length ? "extracted" : "metadata" };
      if (linked.itemIndices.length) entry.itemIndices = linked.itemIndices;
      if (linked.metadataKeys.length) entry.metadataKeys = linked.metadataKeys;
      coverage.push(entry);
    } else if (decisions.has(unitId)) coverage.push(decisions.get(unitId));
    else add("unaccounted_unit", "Source unit has neither a record reference nor an exclusion decision.", { unitId });
  }
  const result = { ...structuredClone(extraction), coverage };
  if (!errors.length) errors.push(...validateCoverage(document, result, { required: true }).errors);
  return { valid: !errors.length, errors, extraction: result };
}
