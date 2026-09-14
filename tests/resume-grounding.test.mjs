import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { documentFromText } from "../lib/resume-parser/layout.mjs";
import { parseResumeDocument } from "../lib/resume-parser/parse.mjs";
import { inspectResumeGrounding, validateResumeGrounding } from "../lib/resume-parser/validate-grounding.mjs";

const fixtureUrl = new URL("./fixtures/resume-parser/factual-resume.txt", import.meta.url);

async function groundedFixture() {
  const document = documentFromText(await fs.readFile(fixtureUrl, "utf8"));
  const result = parseResumeDocument(document);
  return { document, resume: result.resume, provenance: result.report.provenance };
}

function codes(result) {
  return result.map(({ code }) => code);
}

test("accepts a deterministically extracted resume with complete provenance", async () => {
  const input = await groundedFixture();
  assert.deepEqual(validateResumeGrounding(input), []);
  const inspection = inspectResumeGrounding(input);
  assert.equal(inspection.summary.valuesChecked > 0, true);
  assert.equal(inspection.summary.provenanceRecords, inspection.summary.valuesChecked);
  assert.equal(inspection.summary.groundedValues, inspection.summary.valuesChecked);
  assert.equal(inspection.summary.errors, 0);
});

test("rejects a modified numeric metric", async () => {
  const input = await groundedFixture();
  input.resume.work[0].highlights[0] = "Reduced API latency by 40% using Node.js and MongoDB.";
  assert.equal(codes(validateResumeGrounding(input)).includes("modified_numeric_value"), true);
});

test("rejects materially strengthened wording", async () => {
  const input = await groundedFixture();
  input.resume.work[1].highlights[0] = "Led C# and gRPC services.";
  assert.equal(codes(validateResumeGrounding(input)).includes("ungrounded_value"), true);
});

test("rejects a skill without source provenance", async () => {
  const input = await groundedFixture();
  input.resume.skills[0].keywords.push("AWS");
  assert.equal(codes(validateResumeGrounding(input)).includes("missing_provenance"), true);
});

test("rejects invented date precision", async () => {
  const input = await groundedFixture();
  input.resume.work[0].startDate = "2020-01";
  assert.equal(codes(validateResumeGrounding(input)).includes("invented_date_precision"), true);
});

test("rejects provenance that is outside the source document", async () => {
  const input = await groundedFixture();
  input.provenance.find(({ path }) => path === "/basics/name").source = {
    page: 99,
    lineStart: 1,
    text: "Unknown Candidate",
    format: "txt",
  };
  assert.equal(codes(validateResumeGrounding(input)).includes("invalid_provenance_source"), true);
});

test("rejects a copied source excerpt with impossible coordinates", async () => {
  const input = await groundedFixture();
  const name = input.provenance.find(({ path }) => path === "/basics/name");
  name.source = { ...name.source, page: 99 };
  assert.equal(codes(validateResumeGrounding(input)).includes("invalid_provenance_source"), true);
});

test("validates deterministic profile network classification", () => {
  const document = documentFromText("Jane Doe\njane@example.com | https://linkedin.com/in/jane");
  const result = parseResumeDocument(document);
  result.resume.basics.profiles[0].network = "Twitter";
  assert.equal(codes(validateResumeGrounding({ resume: result.resume, provenance: result.report.provenance, document })).includes("ungrounded_value"), true);
});

test("rejects a highlight sourced from another work entry", async () => {
  const input = await groundedFixture();
  const firstHighlight = input.provenance.find(({ path }) => path === "/work/0/highlights/0");
  const secondHighlight = input.provenance.find(({ path }) => path === "/work/1/highlights/0");
  firstHighlight.source = secondHighlight.source;
  assert.equal(codes(validateResumeGrounding(input)).includes("cross_role_evidence"), true);
});

test("allows whitespace and bullet normalization", () => {
  const document = documentFromText(`Jane Doe
Software Engineer
Experience
Example Corp | Software Engineer | 2021 - 2024
- Reduced   latency by 37%.`);
  const result = parseResumeDocument(document);
  assert.equal(result.report.status, "ready");
  assert.deepEqual(result.resume.work[0].highlights, ["Reduced   latency by 37%."]);
  assert.equal(result.report.issues.some(({ kind }) => kind === "grounding"), false);
});
