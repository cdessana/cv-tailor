import assert from "node:assert/strict";
import test from "node:test";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";

const item = (value, quote) => ({
  items: [{ type: "item", value, kind: "skill", classification: "required", evidence: { quote } }],
});

test("valid exact evidence passes", () => {
  const document = preprocess("Experience with Kubernetes is required");
  assert.deepEqual(validateEvidence(document, item("Kubernetes", "Experience with Kubernetes is required")).errors, []);
});

test("whitespace-normalized evidence passes", () => {
  const document = preprocess("Experience with Kubernetes is required");
  const result = validateEvidence(document, item("Kubernetes", "Experience   with\nKubernetes is required"));
  assert.equal(result.valid, true);
});

test("fabricated evidence and unsupported values fail with useful paths", () => {
  const document = preprocess("Experience with cloud platforms is required");
  const result = validateEvidence(document, item("AWS", "Experience with cloud platforms is required"));
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "value_not_supported_by_evidence");
  assert.equal(result.errors[0].path, "/items/0/value");
  const absent = validateEvidence(document, item("cloud", "Experience with AWS is required"));
  assert.equal(absent.errors[0].code, "evidence_not_found");
});

test("approved aliases ground canonical values", () => {
  const document = preprocess("Experience with k8s and postgres is required");
  const extraction = {
    items: [
      { type: "item", value: "Kubernetes", kind: "skill", classification: "required", evidence: { quote: "Experience with k8s" } },
      { type: "item", value: "PostgreSQL", kind: "skill", classification: "required", evidence: { quote: "postgres" } },
    ],
  };
  assert.equal(validateEvidence(document, extraction).valid, true);
});

test("alternatives require every option to be source-supported", () => {
  const document = preprocess("Experience with Java or Kotlin is required");
  const valid = {
    items: [{ type: "alternative", operator: "anyOf", values: ["Java", "Kotlin"], kind: "skill", classification: "required", evidence: { quote: "Java or Kotlin" } }],
  };
  assert.equal(validateEvidence(document, valid).valid, true);
  const invalid = { ...valid, items: [{ ...valid.items[0], values: ["Java", "Kubernetes"] }] };
  assert.equal(validateEvidence(document, invalid).errors[0].path, "/items/0/values/1");
});

test("metadata evidence and malformed inputs are handled", () => {
  const document = preprocess("Example is hiring a Senior Engineer");
  const extraction = { metadata: {
    company: { value: "Example", evidence: { quote: "Example" } },
    title: { value: "Senior Engineer", evidence: { quote: "Senior Engineer" } },
  }, items: [] };
  assert.equal(validateEvidence(document, extraction).valid, true);
  assert.throws(() => validateEvidence(null, extraction), TypeError);
  assert.throws(() => validateEvidence(document, {}), TypeError);
});

test("metadata values must be supported by their own evidence", () => {
  const document = preprocess("Example is hiring a Senior Engineer");
  const result = validateEvidence(document, {
    metadata: {
      company: { value: "Other Company", evidence: { quote: "Example" } },
      title: { value: "Senior Engineer", evidence: { quote: "Example is hiring a Senior Engineer" } },
    },
    items: [],
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].path, "/metadata/company/value");
});

test("all item kinds require value grounding", () => {
  const document = preprocess("Responsibilities\n- Mentor engineers\nRequirements\n- Strong communication");
  for (const [kind, classification] of [["competency", "required"], ["responsibility", "not-applicable"], ["ambiguous", "ambiguous"]]) {
    const result = validateEvidence(document, { items: [{ type: "item", value: "Fabricated value", kind, classification, evidence: { quote: "Mentor engineers" } }] });
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "value_not_supported_by_evidence");
  }
});

test("validation does not mutate extraction", () => {
  const document = preprocess("Experience with Node.js is required");
  const extraction = item("Node.js", "Experience with Node.js is required");
  const before = structuredClone(extraction);
  validateEvidence(document, extraction);
  assert.deepEqual(extraction, before);
});

for (const [badValue, value, quote] of [
  ["Academic background in Computer Science", "academic background in Computer Science", "ideally academic background in Computer Science or a related field."],
  ["Experience gained in big tech environments", "gained in big tech environments", "ideally gained in big tech environments or similarly fast-moving organizations."],
  ["Work onsite, five days a week", "work onsite, five days a week", "That’s why all of our office-based teams work onsite, five days a week."],
]) {
  test(`source wording is required: ${badValue}`, () => {
    const document = preprocess(quote);
    const extraction = item(badValue, quote);
    extraction.items[0].kind = "requirement";
    assert.equal(validateEvidence(document, extraction).errors[0].code, "value_not_supported_by_evidence");
    extraction.items[0].value = value;
    assert.equal(validateEvidence(document, extraction).valid, true);
  });
}
