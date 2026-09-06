import fs from "node:fs/promises";
import Ajv from "ajv";

const schema = JSON.parse(
  await fs.readFile(
    new URL("../../schemas/parser-aliases.schema.json", import.meta.url),
    "utf8"
  )
);
const validateStructure = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
}).compile(schema);

/** Comparison only; never use this return value to rewrite an unknown term. */
export function aliasComparisonKey(value) {
  if (typeof value !== "string")
    throw new TypeError("Alias spelling must be a string.");
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

const pointer = (value) => value.replace(/~/g, "~0").replace(/\//g, "~1");

/** Validate dictionary structure and spelling ownership without changing input. */
export function validateParserAliases(dictionary) {
  if (!validateStructure(dictionary)) {
    return {
      valid: false,
      errors: structuredClone(validateStructure.errors).map((error) => ({
        code: "schema",
        ...error,
      })),
    };
  }
  const seen = new Map();
  const errors = [];
  for (const [canonical, aliases] of Object.entries(dictionary)) {
    const entries = [
      {
        spelling: canonical,
        path: `/${pointer(canonical)}`,
        role: "canonical",
      },
      ...aliases.map((spelling, index) => ({
        spelling,
        path: `/${pointer(canonical)}/${index}`,
        role: "alias",
      })),
    ];
    for (const entry of entries) {
      const key = aliasComparisonKey(entry.spelling);
      const first = seen.get(key);
      if (first) {
        errors.push({
          code: first.canonical === canonical ? "duplicate" : "collision",
          key,
          first,
          second: { canonical, ...entry },
        });
      } else {
        seen.set(key, { canonical, ...entry });
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
