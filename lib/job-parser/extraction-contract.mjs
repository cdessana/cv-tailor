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
const builtInAliases = {
  "REST APIs": ["RESTful APIs", "REST API"], "GCP": ["Google Cloud Platform", "Google Cloud Platform (GCP)"], "RPC": [], "CI/CD": [], "Mentoring": [], "Event-Driven Architecture": [], "Scalable Systems": [], "Automated Testing": ["Test Automation"], "Technical Leadership": [], "Performance Metrics": [], "Reliability": [], "Domain-Driven Design": ["DDD"], "Clean Architecture": [], "Node.js": ["NodeJS"], "MongoDB": ["Mongo DB"], "Kubernetes": ["k8s"], "PostgreSQL": ["postgres"],
};
// Alias data is optional for a newly initialized workspace.  Keep the parser
// available with an empty dictionary until the user creates/imports data.
export const defaultAliases = await (async () => {
  try {
    return JSON.parse(await fs.readFile(new URL("../../data/parser-aliases.json", import.meta.url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return builtInAliases;
    throw error;
  }
})();

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
