import fs from "node:fs/promises";
import Ajv from "ajv";

const schema = JSON.parse(await fs.readFile(new URL("../../schemas/evidence-sources.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

export function validateSupportingSources(supportingSources = []) {
  if (validate(supportingSources)) return supportingSources;
  const details = (validate.errors ?? []).map((error) => ({ path: error.instancePath || "/", message: error.message }));
  const issue = new Error("Supporting sources do not satisfy the evidence-sources contract.");
  issue.code = "EVIDENCE_SOURCE_CONTRACT_INVALID";
  issue.details = details;
  throw issue;
}
