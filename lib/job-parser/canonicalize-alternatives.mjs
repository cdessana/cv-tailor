const normalize = value => String(value).replace(/\s+/gu, " ").trim();

const directChoice = /^(?<left>[\p{L}\p{N}+#./+-]+(?:\s+[\p{L}\p{N}+#./+-]+){0,2})\s+(?:or|ou|e\/ou|and\/or)\s+(?<right>[\p{L}\p{N}+#./+-]+(?:\s+[\p{L}\p{N}+#./+-]+){0,2})$/iu;
const nonChoiceSuffix = /\b(?:higher|superior|equivalent|equivalente|more|mais)\b/iu;

/**
 * Convert only a standalone, short, explicit choice into the canonical anyOf
 * record. This is deliberately not a sentence parser: qualifications with
 * shared prefixes, durations, examples, or prose remain model-owned and must
 * be returned as a structured alternative by the provider.
 */
export function canonicalizeDirectAlternative(item) {
  if (!item || typeof item !== "object" || Array.isArray(item) || item.type !== "item" || !["required", "preferred"].includes(item.classification)
      || !["skill", "requirement", "competency"].includes(item.kind)) return item;
  const value = normalize(item.value);
  const match = directChoice.exec(value);
  if (!match || nonChoiceSuffix.test(value)) return item;
  const values = [normalize(match.groups.left), normalize(match.groups.right)];
  if (new Set(values.map(value => value.toLocaleLowerCase())).size !== 2) return item;
  return {
    type: "alternative",
    operator: "anyOf",
    kind: item.kind,
    classification: item.classification,
    values,
    evidence: structuredClone(item.evidence),
    ...(item.sourceUnitIds ? { sourceUnitIds: [...item.sourceUnitIds] } : {}),
    ...(item.sourceSection ? { sourceSection: item.sourceSection } : {}),
  };
}

export function canonicalizeDirectAlternatives(extraction) {
  // Structural validation remains the source of the public diagnostic. Do not
  // turn malformed provider payloads into incidental TypeErrors here.
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return extraction;
  const result = structuredClone(extraction);
  if (!Array.isArray(result.items)) return result;
  result.items = result.items.map(canonicalizeDirectAlternative);
  return result;
}
