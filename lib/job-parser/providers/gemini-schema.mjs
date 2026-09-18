import fs from "node:fs/promises";

const contract = JSON.parse(await fs.readFile(new URL("../../../schemas/job-parser.schema.json", import.meta.url), "utf8"));

// Adapt this contract's finite references and classification branches to Gemini's
// documented JSON Schema subset. Do not send unsupported allOf/const constraints.
function adapt(schema) {
  if (schema.$ref) {
    const name = schema.$ref.replace("#/definitions/", "");
    if (!contract.definitions[name]) throw new Error(`Unknown parser schema reference: ${schema.$ref}`);
    return adapt(contract.definitions[name]);
  }
  const result = {};
  for (const key of ["type", "description", "enum", "required", "minItems", "minimum", "additionalProperties"]) {
    if (key in schema) result[key] = structuredClone(schema[key]);
  }
  if ("const" in schema) result.enum = [schema.const];
  if (schema.properties) result.properties = Object.fromEntries(
    Object.entries(schema.properties).map(([key, value]) => [key, adapt(value)]));
  if (schema.items) result.items = adapt(schema.items);
  if (schema.oneOf) result.anyOf = schema.oneOf.map(adapt);
  // Kind/classification combinations are checked by the canonical local schema.
  return result;
}

// Records in the wire format inherit their source from the containing block.
const itemSchema = adapt(contract.definitions.item);
const alternativeSchema = adapt(contract.definitions.alternative);
const metadataSchema = adapt(contract.properties.metadata);
function removeSourceIds(schema) {
  if (schema.properties) delete schema.properties.sourceUnitIds;
  for (const branch of schema.anyOf ?? []) removeSourceIds(branch);
  for (const property of Object.values(schema.properties ?? {})) removeSourceIds(property);
}
removeSourceIds(itemSchema);
removeSourceIds(alternativeSchema);
removeSourceIds(metadataSchema);
// Candidate aggregation is local; a model must return only this block's record.
for (const field of Object.values(metadataSchema.properties)) delete field.properties.candidates;

function stripAdditionalProperties(schema) {
  if (schema && typeof schema === "object") {
    delete schema.additionalProperties;
    for (const key of Object.keys(schema)) {
      stripAdditionalProperties(schema[key]);
    }
  }
}

export function createBlockSchema() {
  // We need to define the tool for each block, but Gemini Tools accepts a single tool definition.
  // We'll define a generic block extraction tool and instruct the model to call it for each block.
  // The schema here defines the *arguments* for the function.
  const schema = {
    name: "extract_block",
    description: "Extract job records from a single source block.",
    parameters: {
      type: "object",
      required: ["id", "status", "items", "alternatives", "metadata", "reason"],
      properties: {
        id: { type: "string" },
        status: { enum: ["extracted", "excluded"] },
        items: { type: "array", items: itemSchema },
        alternatives: { type: "array", items: alternativeSchema },
        metadata: metadataSchema,
        reason: { type: "string" },
      },
    },
  };
  const cloned = structuredClone(schema);
  stripAdditionalProperties(cloned);
  return cloned;
}

export function createValidationSchema(blocks) {
  const properties = {};
  const required = [];
  const blockSchema = {
    type: "object",
    additionalProperties: false,
    required: ["status", "items", "alternatives", "metadata", "reason"],
    properties: {
      status: { enum: ["extracted", "excluded"] },
      items: { type: "array", items: itemSchema },
      alternatives: { type: "array", items: alternativeSchema },
      metadata: metadataSchema,
      reason: { type: "string" },
    },
  };

  for (const block of blocks) {
    properties[block.id] = blockSchema;
    required.push(block.id);
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["blocks"],
    properties: {
      blocks: {
        type: "object",
        additionalProperties: false,
        properties,
        required,
      },
    },
  };
}
