import fs from "node:fs/promises";
import Ajv from "ajv";
import { EXTERNAL_SUPPORTING_SOURCE_TYPES } from "./schema.mjs";

const schema = JSON.parse(await fs.readFile(new URL("../../schemas/evidence-sources.schema.json", import.meta.url), "utf8"));
const schemaSourceTypes = schema.definitions?.source?.properties?.type?.enum;
if (!Array.isArray(schemaSourceTypes) || schemaSourceTypes.length !== EXTERNAL_SUPPORTING_SOURCE_TYPES.size || schemaSourceTypes.some((type) => !EXTERNAL_SUPPORTING_SOURCE_TYPES.has(type))) {
  throw new Error("Evidence supporting-source schema must declare exactly the external supporting source types.");
}
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

export function validateSupportingSources(supportingSources = []) {
  if (validate(supportingSources)) return supportingSources;
  const details = (validate.errors ?? []).map((error) => ({ path: error.instancePath || "/", message: error.message }));
  const issue = new Error("Supporting sources do not satisfy the evidence-sources contract.");
  issue.code = "EVIDENCE_SOURCE_CONTRACT_INVALID";
  issue.details = details;
  throw issue;
}
