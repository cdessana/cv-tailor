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

test("reports missing required metadata even when location is present", () => {
  const result = mapToJob({ metadata: { location: { value: "Remote", ...evidence("Remote") } }, items: [] });
  assert.deepEqual(result.errors.map(({ code }) => code), ["missing_metadata", "missing_metadata"]);
});

test("rejects ambiguous items even alongside representable alternatives", () => {
  const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [{ type: "alternative", operator: "anyOf", values: ["AWS", "GCP"], kind: "skill", classification: "required", ...evidence("AWS or GCP") }, item("cloud experience", "ambiguous", "ambiguous")] });
  assert.deepEqual(result.errors.map(({ code }) => code), ["ambiguous_item"]);
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

for (const [context, values] of [
  ["Computer Science or a related field", ["Computer Science", "a related field"]],
  ["Backend or Integration Software Engineer", ["Backend", "Integration Software Engineer"]],
  ["Scrum ou Kanban", ["Scrum", "Kanban"]],
]) {
  test(`preserves alternative context: ${context}`, () => {
    const metadata = { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } };
    const result = mapToJob({ metadata, items: [{ type: "alternative", operator: "anyOf", values, kind: "requirement", classification: "preferred", ...evidence(context) }] });
    assert.equal(result.valid, true);
    assert.deepEqual(result.job.alternativeRequirements, [{ operator: "anyOf", values, kind: "requirement", classification: "preferred", context }]);
    const plain = mapToJob({ metadata, items: [item(context, "requirement", "preferred")] });
    assert.equal(plain.valid, true);
    assert.equal(plain.warnings[0].code, "unstructured_alternative");
  });
}

test("does not promote descriptive OR wording to an alternative", () => {
  const value = "driving initiatives at a broader level across an organization or company";
  const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [item(value, "skill", "preferred")] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.job.requirements.preferred, [value]);
});

test("drops model-grouped lists without source choice wording", () => {
  const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [{ type: "alternative", operator: "anyOf", values: ["Java", "Kotlin"], kind: "skill", classification: "required", ...evidence("Experience with Java, Kotlin and Python") }] });
  assert.equal(result.valid, true);
  assert.equal(result.job.alternativeRequirements, undefined);
});
