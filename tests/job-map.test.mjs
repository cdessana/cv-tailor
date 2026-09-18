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

test("omits only an ordinary prefix shadowed by the same alternative evidence", () => {
  const metadata = { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } };
  const quote = "Experience in production with Go or Kotlin";
  const extraction = { metadata, items: [
    item("Experience in production", "requirement", "preferred", quote),
    { type: "alternative", operator: "anyOf", kind: "requirement", classification: "preferred", values: ["Go", "Kotlin"], ...evidence(quote) },
    item("Experience in production systems", "requirement", "preferred", "Experience in production systems"),
  ] };
  const result = mapToJob(extraction);
  assert.equal(result.valid, true);
  assert.deepEqual(result.job.requirements.preferred, ["Experience in production systems"]);
  assert.equal(result.job.alternativeRequirements.length, 1);
  assert.equal(result.warnings[0].code, "shadowed_item");
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
    
    // We now accept certain descriptive OR patterns like "Computer Science or a related field"
    // instead of throwing unstructured_alternative to accommodate small models.
    if (context === "Computer Science or a related field") {
      assert.equal(plain.valid, true);
    } else {
      assert.equal(plain.valid, false);
      assert.equal(plain.errors[0].code, "unstructured_alternative");
    }
  });
}

test("does not promote descriptive OR wording to an alternative", () => {
  const value = "driving initiatives at a broader level across an organization or company";
  const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [item(value, "skill", "preferred")] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.job.requirements.preferred, [value]);
});

test("rejects model-grouped lists even if all values occur in evidence", () => {
  const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [{ type: "alternative", operator: "anyOf", values: ["Java", "Kotlin"], kind: "skill", classification: "required", ...evidence("Experience with Java, Kotlin and Python") }] });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "invalid_alternative");
});

for (const value of ["Degree or equivalent", "Bacharelado ou superior", "3 or more years of experience", "5 ou mais anos de experiência"]) {
  test(`retains qualification wording: ${value}`, () => {
    const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [item(value, "requirement", "required")] });
    assert.equal(result.valid, true);
    assert.deepEqual(result.job.requirements.required, [value]);
  });
}

for (const value of ["3 or more years with Java or Kotlin", "5 ou mais anos com Java ou Kotlin", "Java or more technologies"]) {
  test(`threshold does not hide a choice: ${value}`, () => {
    const result = mapToJob({ metadata: { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } }, items: [item(value, "requirement", "required")] });
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "unstructured_alternative");
  });
}

for (const [value, quote, values] of [
  ["Familiarity with modern component-based UI frameworks", "Familiarity with modern component-based UI frameworks (such as React or Angular) to support the TypeScript rewrite.", ["React", "Angular"]],
  ["Understanding of cloud architecture and containerization", "Understanding of cloud architecture and containerization (e.g., Docker, Kubernetes).", ["Docker", "Kubernetes"]],
  ["Conhecimento de frameworks", "Conhecimento de frameworks (como React ou Angular).", ["React", "Angular"]],
]) {
  test(`preserves broad qualification and rejects example-only group: ${value}`, () => {
    const metadata = { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } };
    const plain = mapToJob({ metadata, items: [{ ...item(value, "requirement", "preferred", quote), examples: values.map(value => ({ value })) }] });
    assert.equal(plain.valid, true);
    assert.deepEqual(plain.job.requirements.preferred, [value]);
    const grouped = mapToJob({ metadata, items: [{ type: "alternative", operator: "anyOf", values, kind: "skill", classification: "preferred", ...evidence(quote) }] });
    assert.equal(grouped.valid, false);
    assert.equal(grouped.job, null);
    assert.equal(grouped.errors[0].code, "invalid_alternative");
  });
}

test("example elsewhere in evidence does not invalidate a separate real choice", () => {
  const metadata = { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } };
  const result = mapToJob({ metadata, items: [{ type: "alternative", operator: "anyOf", values: ["Java", "Kotlin"], kind: "skill", classification: "required", ...evidence("Java or Kotlin and knowledge of containers (e.g., Docker, Kubernetes).") }] });
  assert.equal(result.valid, true);
});

test("maps only explicit intermediate examples without reparsing source prose", () => {
  const metadata = { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } };
  const value = "Experiência com soluções em Cloud, principalmente AWS";
  const extraction = {
    metadata,
    items: [{ ...item(value, "skill", "required"), examples: [{ value: "AWS" }] }],
  };
  const result = mapToJob(extraction);
  assert.equal(result.valid, true);
  assert.deepEqual(result.job.requirements.required, [value]);
  assert.deepEqual(result.job.requirementExamples, [{
    classification: "required", requirement: value, values: ["AWS"],
  }]);
});

test("does not derive examples from item wording during compatibility mapping", () => {
  const metadata = { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } };
  const value = "Experiência com bancos NoSQL, como MongoDB e Cassandra";
  const result = mapToJob({ metadata, items: [item(value, "skill", "required")] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.job.requirements.required, [value]);
  assert.equal(result.job.requirementExamples, undefined);
});

test("preserves generic alternative options without narrowing their semantics", () => {
  const metadata = { company: { value: "Example", ...evidence("Example") }, title: { value: "Engineer", ...evidence("Engineer") } };
  const result = mapToJob({
    metadata,
    items: [{ type: "alternative", operator: "anyOf", values: ["AWS", "similar tools"], kind: "skill", classification: "preferred", ...evidence("AWS or similar tools") }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.job.alternativeRequirements, [{
    operator: "anyOf", values: ["AWS", "similar tools"], kind: "skill", classification: "preferred", context: "AWS or similar tools",
  }]);
});
