import fs from "node:fs/promises";
import { validateResume } from "../lib/resume-parser/validate.mjs";

const resumePath = process.argv[2] ?? "data/resumes/base.json";

const resume = JSON.parse(await fs.readFile(resumePath, "utf8"));
const { valid, errors } = validateResume(resume);

if (valid) {
  console.log("✓ Resume is valid.");
  process.exit(0);
}

console.error("✗ Resume is invalid.\n");

for (const error of errors) {
  console.error(`${error.path}: ${error.message}`);
}

process.exit(1);
