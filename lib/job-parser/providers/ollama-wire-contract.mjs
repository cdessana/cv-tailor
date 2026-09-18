const metadataKeys = [
  "company",
  "title",
  "location",
  "workArrangement",
  "employmentType",
  "sourceUrl",
];

// Keep the local-model contract deliberately flat. The canonical application
// contract remains the source of truth and validates the translated response.
export const ollamaWireSchema = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "reason", "records"],
        properties: {
          id: { type: "string" },
          status: { enum: ["extracted", "excluded"] },
          reason: { type: "string" },
          records: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "recordType",
                "metadataKey",
                "value",
                "values",
                "kind",
                "classification",
                "quote",
                "examples",
              ],
              properties: {
                recordType: { enum: ["item", "alternative", "metadata"] },
                metadataKey: { enum: ["none", ...metadataKeys] },
                value: { type: "string" },
                values: { type: "array", items: { type: "string" } },
                kind: {
                  enum: [
                    "none",
                    "skill",
                    "requirement",
                    "responsibility",
                    "competency",
                    "ambiguous",
                  ],
                },
                classification: {
                  enum: [
                    "none",
                    "required",
                    "preferred",
                    "ambiguous",
                    "not-applicable",
                  ],
                },
                quote: { type: "string" },
                examples: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
};

function invalid(message) {
  throw new TypeError(`Invalid Ollama wire response: ${message}`);
}

function translateWireBlock(result, block) {
  if (!Array.isArray(result.records))
    invalid(`records for ${result.id} must be an array.`);
  const canonical = {
    status: result.status,
    reason: result.reason,
    items: [],
    alternatives: [],
    metadata: {},
  };
  const records =
    result.status !== "extracted" &&
    result.records.every(
      (record) =>
        typeof record?.value === "string" &&
        record.value.trim() === "" &&
        Array.isArray(record.values) &&
        record.values.length === 0 &&
        record.metadataKey === "none" &&
        record.kind === "none"
    )
      ? []
      : result.records;
  for (const record of records) {
    const evidence = { quote: record.quote };
    const sourceSection = block.heading ? { sourceSection: block.heading } : {};
    if (record.recordType === "metadata") {
      if (!metadataKeys.includes(record.metadataKey))
        invalid(`metadata record in ${result.id} requires metadataKey.`);
      canonical.metadata[record.metadataKey] = {
        value: record.value,
        evidence,
        ...sourceSection,
      };
    } else if (record.recordType === "alternative") {
      canonical.alternatives.push({
        type: "alternative",
        operator: "anyOf",
        values: record.values,
        kind: record.kind,
        classification: record.classification,
        evidence,
        ...sourceSection,
      });
    } else if (record.recordType === "item") {
      canonical.items.push({
        type: "item",
        value: record.value,
        kind: record.kind,
        classification: record.classification,
        evidence,
        ...(record.examples.length
          ? { examples: record.examples.map((value) => ({ value })) }
          : {}),
        ...sourceSection,
      });
    } else invalid(`unknown record type in ${result.id}.`);
  }
  return canonical;
}

export function translateOllamaWireResponsePartially(response, blocks) {
  if (!response || !Array.isArray(response.blocks))
    invalid("blocks must be an array.");
  const expected = new Map(blocks.map((block) => [block.id, block]));
  const seen = new Set();
  const translated = { blocks: {} };
  const rejectedBlocks = {};
  for (const result of response.blocks) {
    if (!result || typeof result.id !== "string" || !expected.has(result.id))
      invalid(`unknown block ID ${JSON.stringify(result?.id)}.`);
    if (seen.has(result.id)) invalid(`duplicate block ID ${result.id}.`);
    seen.add(result.id);
    try {
      translated.blocks[result.id] = translateWireBlock(
        result,
        expected.get(result.id)
      );
    } catch (error) {
      rejectedBlocks[result.id] = {
        response: structuredClone(result),
        error,
      };
    }
  }
  return { response: translated, rejectedBlocks };
}

export function translateOllamaWireResponse(
  response,
  blocks,
  { allowMissing = false } = {}
) {
  const { response: translated, rejectedBlocks } =
    translateOllamaWireResponsePartially(response, blocks);
  const rejected = Object.keys(rejectedBlocks);
  if (rejected.length) {
    const firstError = rejectedBlocks[rejected[0]].error;
    throw new Error(`Block translation failed for IDs: ${rejected.join(", ")}. Original error: ${firstError.message}`);
  }
  const missing = blocks
    .map((block) => block.id)
    .filter((id) => !translated.blocks[id]);
  if (!allowMissing && missing.length)
    invalid(`missing block IDs: ${missing.join(", ")}.`);
  return translated;
}
