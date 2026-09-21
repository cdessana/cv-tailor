// Compatibility bridge for a narrow semantic-enrichment contract. Providers
// may return decisions instead of reconstructing canonical source fields.
const trimBullet = (text) => text
  .replace(/^\s*(?:[-*+•◦▪]|\d+[.)])\s+/u, "")
  .trim();

function descriptor(unit, section, action) {
  if (action === "responsibility")
    return { kind: "responsibility", classification: "not-applicable" };
  if (action === "requirement") {
    if (!["required", "preferred"].includes(section.signal)) return null;
    return { kind: "requirement", classification: section.signal };
  }
  return null;
}

const normalized = (value) => String(value).replace(/\s+/gu, " ").trim().toLocaleLowerCase();
const metadataKeys = new Set(["company", "title", "location", "workArrangement", "employmentType", "sourceUrl"]);

/**
 * Materialize narrow source-ID decisions locally. This intentionally derives
 * quote, section, classification and coverage from the preprocessed document;
 * providers never need to reproduce those validator-sensitive fields.
 */
export function materializeSemanticDecisions(document, response) {
  if (!Array.isArray(response?.decisions)) return null;
  const lookup = new Map((document.sections ?? []).flatMap((section) =>
    section.units.map((unit) => [unit.id, { unit, section }])
  ));
  const items = [];
  const metadata = {};
  const coverage = [];
  const seen = new Set();
  for (const decision of response.decisions) {
    if (!decision || typeof decision.unitId !== "string" || seen.has(decision.unitId))
      throw new TypeError("Semantic decisions require unique source unit IDs.");
    seen.add(decision.unitId);
    const source = lookup.get(decision.unitId);
    if (!source) throw new TypeError(`Semantic decision references unknown unit ${decision.unitId}.`);
    if (decision.action === "exclude") {
      coverage.push({ unitId: decision.unitId, status: "excluded", reason: "Semantic enrichment excluded this ambiguous source unit." });
      continue;
    }
    if (decision.action === "metadata") {
      if (!metadataKeys.has(decision.metadataKey) ||
        typeof decision.value !== "string" || !normalized(decision.value) ||
        !normalized(source.unit.originalText).includes(normalized(decision.value)))
        throw new TypeError(`Semantic metadata ${decision.unitId} is not source-grounded.`);
      if (metadata[decision.metadataKey])
        throw new TypeError(`Semantic decisions contain duplicate ${decision.metadataKey} metadata.`);
      metadata[decision.metadataKey] = {
        value: decision.value,
        evidence: { quote: source.unit.originalText },
        sourceUnitIds: [source.unit.id],
        ...(source.section.heading ? { sourceSection: source.section.heading.text } : {}),
      };
      coverage.push({ unitId: source.unit.id, status: "metadata", metadataKeys: [decision.metadataKey] });
      continue;
    }
    if (decision.action === "alternative") {
      if (!["required", "preferred"].includes(source.section.signal))
        throw new TypeError(`Semantic alternative ${decision.unitId} has no explicit qualification classification.`);
      if (!Array.isArray(decision.values) || decision.values.length < 2 ||
        new Set(decision.values.map(normalized)).size !== decision.values.length ||
        decision.values.some((value) => !normalized(value) || !normalized(source.unit.originalText).includes(normalized(value))))
        throw new TypeError(`Semantic alternative ${decision.unitId} has unsupported option values.`);
      items.push({
        type: "alternative",
        operator: "anyOf",
        values: [...decision.values],
        kind: "requirement",
        classification: source.section.signal,
        evidence: { quote: source.unit.originalText },
        sourceUnitIds: [source.unit.id],
        ...(source.section.heading ? { sourceSection: source.section.heading.text } : {}),
      });
      coverage.push({ unitId: source.unit.id, status: "extracted", itemIndices: [items.length - 1] });
      continue;
    }
    const record = descriptor(source.unit, source.section, decision.action);
    if (!record) throw new TypeError(`Semantic decision ${decision.action} is not safe for ${decision.unitId}.`);
    const value = trimBullet(source.unit.originalText);
    if (!value) throw new TypeError(`Semantic decision ${decision.unitId} has no source text.`);
    items.push({
      type: "item",
      value,
      ...record,
      evidence: { quote: source.unit.originalText },
      sourceUnitIds: [source.unit.id],
      ...(source.section.heading ? { sourceSection: source.section.heading.text } : {}),
    });
    coverage.push({ unitId: source.unit.id, status: "extracted", itemIndices: [items.length - 1] });
  }
  return {
    items,
    ...(Object.keys(metadata).length ? { metadata } : {}),
    coverage,
  };
}
