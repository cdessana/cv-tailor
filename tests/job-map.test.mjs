import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";

const evidence = (quote) => ({ evidence: { quote } });
const item = (value, kind, classification, quote = value) => ({ type: "item", value, kind, classification, ...evidence(quote) });

test("maps metadata, classifications, competencies, and responsibilities", () => {
  const result = mapToJob({
    metadata: {
      company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") },
      employmentType: { value: "Full-time", ...evidence("Full-time") }, sourceUrl: { value: "https://example.com/job", ...evidence("https://example.com/job") },
    },
    items: [item("Node.js", "skill", "required"), item("Kubernetes", "skill", "preferred"), item("Communication", "competency", "preferred"), item("Mentor engineers", "responsibility", "not-applicable")],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.job, { company: "Example", title: "Engineer", type: "Full-time", source: { url: "https://example.com/job" }, requirements: { required: ["Node.js"], preferred: ["Kubernetes"], competencies: ["Communication"] }, responsibilities: ["Mentor engineers"] });
});

test("reports missing and unsupported metadata", () => {
  const result = mapToJob({ metadata: { location: { value: "Remote", ...evidence("Remote") } }, items: [] });
  assert.deepEqual(result.errors.map(({ code }) => code), ["missing_metadata", "missing_metadata", "unsupported_metadata"]);
});

test("rejects alternatives and ambiguous items", () => {
  const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [{ type: "alternative", operator: "anyOf", values: ["AWS", "GCP"], kind: "skill", classification: "required", ...evidence("AWS or GCP") }, item("cloud experience", "ambiguous", "ambiguous")] });
  assert.deepEqual(result.errors.map(({ code }) => code), ["unsupported_alternative", "ambiguous_item"]);
});

test("does not mutate intermediate extraction", () => {
  const extraction = { metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [item("Node.js", "skill", "required")] };
  const before = structuredClone(extraction);
  mapToJob(extraction);
  assert.deepEqual(extraction, before);
});

test("existing fixture remains available unchanged", async () => {
  const fixture = JSON.parse(await fs.readFile(new URL("../data/jobs/flash-senior-backend.json", import.meta.url), "utf8"));
  assert.equal(fixture.company, "Flash");
  assert.equal(fixture.requirements.required.length > 0, true);
});
