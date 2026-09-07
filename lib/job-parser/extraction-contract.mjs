import fs from "node:fs/promises";
import Ajv from "ajv";
import {
  aliasComparisonKey,
  validateParserAliases,
} from "./validate-aliases.mjs";

const schema = JSON.parse(
  await fs.readFile(
    new URL("../../schemas/job-parser.schema.json", import.meta.url),
    "utf8"
  )
);
const validate = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
}).compile(schema);
export const defaultAliases = JSON.parse(
  await fs.readFile(
    new URL("../../data/parser-aliases.json", import.meta.url),
    "utf8"
  )
);

export function assertExtraction(value) {
  if (!validate(value))
    throw new TypeError(
      `Invalid intermediate extraction: ${JSON.stringify(validate.errors)}`
    );
}

export function aliasIndex(dictionary) {
  const result = validateParserAliases(dictionary);
  if (!result.valid)
    throw new TypeError(
      `Invalid parser aliases: ${JSON.stringify(result.errors)}`
    );
  return new Map(
    Object.entries(dictionary).flatMap(([canonical, aliases]) =>
      [canonical, ...aliases].map((value) => [
        aliasComparisonKey(value),
        canonical,
      ])
    )
  );
}
