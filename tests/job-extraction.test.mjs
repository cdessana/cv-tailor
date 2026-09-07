import assert from "node:assert/strict";
import test from "node:test";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { extract } from "../lib/job-parser/extract.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";

for (const [text, value, classification] of [
  ["Experience with Node.js is required", "Node.js", "required"],
  ["Node.js is required.", "Node.js", "required"],
  ["Required: nodejs!", "nodejs", "required"],
  ["Nice to have: Kubernetes", "Kubernetes", "preferred"],
  ["Preferred: postgres", "postgres", "preferred"],
  ["EXPERIENCE WITH NodeJS IS PREFERRED.", "NodeJS", "preferred"],
  ["Requirements\n- Experience with Mongo DB", "Mongo DB", "required"],
  ["Bonus\n- Kubernetes", "Kubernetes", "preferred"],
  ["Requirements\n- Nice to have: k8s", "k8s", "preferred"],
]) {
  test(`extract ${text}`, () => {
    const result = extract(preprocess(text));
    assert.equal(result.unresolved.length, 0);
    assert.equal(result.extraction.items.length, 1);
    assert.equal(result.extraction.items[0].value, value);
    assert.equal(result.extraction.items[0].classification, classification);
    assert.equal(result.extraction.items[0].kind, "skill");
  });
}
for (const text of [
  "Node.js is not required",
  "No experience with Node.js is required",
  "Required: Node.js but optional",
  "Nice to have: Node.js is required",
  "Experience with Node.js is required if available",
  "Node.js is required. Java is preferred.",
  "Requirements\n- You will mentor engineers",
  "Responsibilities\n- Node.js is required",
  "Nice to have: AWS and GCP",
  "Required: AWS or (GCP and Azure)",
  "Required: AWS, GCP",
  "Required: AWS or GCP, Azure or Java",
  "Required: AWS or",
  "Required: AWS or AWS",
  "Required: Node.js; build APIs",
  "Required: Node.js is preferred",
  "Required: AWS or GCP, Azure",
]) {
  test(`unresolved ${text}`, () => {
    const doc = preprocess(text);
    const result = extract(doc);
    assert.deepEqual(result.extraction.items, []);
    assert.equal(result.unresolved.length, 1);
    assert.deepEqual(result.unresolved[0].unit, doc.sections[0].units[0]);
  });
}
for (const [text, values] of [
  ["Experience with AWS or GCP is required", ["AWS", "GCP"]],
  ["Nice to have: AWS, GCP, or Azure", ["AWS", "GCP", "Azure"]],
  ["Required: Java or Kotlin", ["Java", "Kotlin"]],
  ["Preferred: nodejs or k8s", ["nodejs", "k8s"]],
]) {
  test(`alternative ${text}`, () => {
    const { extraction } = extract(preprocess(text));
    assert.equal(extraction.items.length, 1);
    assert.equal(extraction.items[0].type, "alternative");
    assert.equal(extraction.items[0].operator, "anyOf");
    assert.deepEqual(extraction.items[0].values, values);
  });
}
const single = (value) => ({
  items: [
    {
      type: "item",
      kind: "requirement",
      classification: "required",
      value,
      evidence: { quote: "Original source" },
    },
  ],
});
for (const [value, expected] of [
  ["nodejs", "Node.js"],
  ["node.js", "Node.js"],
  ["k8s", "Kubernetes"],
  ["postgres", "PostgreSQL"],
  ["  MONGO  DB ", "MongoDB"],
  ["cloud", "cloud"],
  ["JVM", "JVM"],
  ["CI/CD", "CI/CD"],
  ["GitHub Actions", "GitHub Actions"],
  ["gRPC", "gRPC"],
  ["  UnknownTech  ", "  UnknownTech  "],
  ["Experience with NodeJS", "Experience with NodeJS"],
]) {
  test(`normalize complete value ${value}`, () => {
    const input = single(value);
    const before = structuredClone(input);
    const result = normalizeExtraction(input);
    assert.equal(result.items[0].value, expected);
    assert.deepEqual(input, before);
    assert.deepEqual(result.items[0].evidence, input.items[0].evidence);
  });
}
test("integration preserves original extraction, metadata and evidence", () => {
  const doc = preprocess(
    "Requirements\r\n• Experience with nodejs\r\n  is required\r\n\r\nBonus:\r\n- Preferred: k8s or postgres"
  );
  const originalDoc = structuredClone(doc);
  const result = extract(doc);
  const before = structuredClone(result);
  const normalized = normalizeExtraction(result.extraction);
  assert.equal(result.extraction.items[0].value, "nodejs");
  assert.equal(normalized.items[0].value, "Node.js");
  assert.deepEqual(normalized.items[1].values, ["Kubernetes", "PostgreSQL"]);
  assert.equal(
    normalized.items[0].evidence.quote,
    "• Experience with nodejs\r\n  is required"
  );
  assert.equal(normalized.items[0].sourceSection, "Requirements");
  assert.deepEqual(doc, originalDoc);
  assert.deepEqual(result, before);
  const input = {
    ...single("nodejs"),
    metadata: { company: { value: "nodejs", evidence: { quote: "nodejs" } } },
  };
  assert.deepEqual(normalizeExtraction(input).metadata, input.metadata);
});
test("unknown explicit qualifications keep generic kind", () => {
  for (const value of [
    "UnknownTech",
    ".NET",
    "Five years of experience",
    "Communication",
  ]) {
    const result = extract(preprocess(`Required: ${value}`));
    assert.equal(result.extraction.items[0].kind, "requirement");
    assert.equal(result.extraction.items[0].value, value);
  }
});
test("empty input and unsupported source remain separate", () => {
  assert.deepEqual(extract(preprocess("")), {
    extraction: { items: [] },
    unresolved: [],
  });
  const doc = preprocess("Join us\n\nRequired: nodejs\n\nOther details");
  const result = extract(doc);
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.unresolved.length, 2);
});

test("extracts explicit company and title metadata without semantic inference", () => {
  const result = extract(preprocess("Example is hiring a Senior Engineer\nRequirements\n- Node.js is required"));
  assert.deepEqual(result.extraction.metadata, {
    company: { value: "Example", evidence: { quote: "Example is hiring a Senior Engineer" } },
    title: { value: "Senior Engineer", evidence: { quote: "Example is hiring a Senior Engineer" } },
  });
  assert.equal(result.unresolved.length, 0);
});
test("reject malformed documents and altered source ranges", () => {
  for (const value of [null, {}, "text", { originalText: "" }])
    assert.throws(() => extract(value), TypeError);
  const doc = preprocess("Required: nodejs");
  doc.sections[0].units[0].start = 2;
  assert.throws(() => extract(doc), TypeError);
});
test("reject invalid dictionary in both stages", () => {
  const dictionary = { A: ["shared"], B: ["SHARED"] };
  assert.throws(
    () => extract(preprocess("Required: A"), dictionary),
    /Invalid parser aliases/
  );
  assert.throws(
    () => normalizeExtraction(single("A"), dictionary),
    /Invalid parser aliases/
  );
});
test("reject schema-invalid normalization input", () => {
  for (const value of [
    {},
    single(123),
    { ...single("Node.js"), unexpected: true },
  ])
    assert.throws(
      () => normalizeExtraction(value),
      /Invalid intermediate extraction/
    );
});
test("reject alternatives collapsed by normalization without mutation", () => {
  const result = extract(preprocess("Required: nodejs or Node.js"));
  const before = structuredClone(result);
  assert.throws(
    () => normalizeExtraction(result.extraction),
    /collapses alternative/
  );
  assert.deepEqual(result, before);
});
