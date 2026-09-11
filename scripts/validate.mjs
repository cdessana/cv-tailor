import fs from "node:fs/promises";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const resumePath = "data/resumes/base.json";

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));

const schemaResponse = await fetch(
  "https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json"
);

if (!schemaResponse.ok) {
  throw new Error(
    `Could not load JSON Resume schema: ${schemaResponse.status}`
  );
}

const schema = await schemaResponse.json();

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

addFormats(ajv);

const validate = ajv.compile(schema);

const valid = validate(resume);

if (valid) {
  console.log("✓ Resume is valid.");
  process.exit(0);
}

console.error("✗ Resume is invalid.\n");

for (const error of validate.errors ?? []) {
  console.error(`${error.instancePath || "/"}: ${error.message}`);

  if (error.params) {
    console.error(`  ${JSON.stringify(error.params)}`);
  }
}

process.exit(1);
