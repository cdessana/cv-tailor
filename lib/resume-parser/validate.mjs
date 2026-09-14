import fs from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const schema = JSON.parse(
  fs.readFileSync(new URL("../../schemas/jsonresume.schema.json", import.meta.url), "utf8")
);
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

export function validateResume(resume) {
  const valid = validate(resume);
  return {
    valid,
    errors: valid ? [] : (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      message: error.message,
    })),
  };
}
