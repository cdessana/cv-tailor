import assert from "node:assert/strict";
import test from "node:test";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { extract } from "../lib/job-parser/extract.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";

async function run(text, response) {
  const document = preprocess(text);
  const deterministic = extract(document);
  const result = await semanticExtract(document, deterministic, async (input) => {
    assert.equal(input.unresolved.length, deterministic.unresolved.length);
    assert.equal("candidate" in input, false);
    return response;
  });
  return { document, deterministic, result };
}

test("accepts responsibilities, competencies, ambiguity, alternatives, and metadata", async () => {
  const text = "Senior Engineer at Example\nResponsibilities\n- You will mentor engineers\nRequirements\n- Strong communication skills\n- Java or Kotlin";
  const response = {
    metadata: {
      company: { value: "Example", evidence: { quote: "at Example" } },
      title: { value: "Senior Engineer", evidence: { quote: "Senior Engineer" } },
    },
    items: [
      { type: "item", value: "You will mentor engineers", kind: "responsibility", classification: "not-applicable", evidence: { quote: "You will mentor engineers" }, sourceSection: "Responsibilities" },
      { type: "item", value: "Strong communication skills", kind: "competency", classification: "ambiguous", evidence: { quote: "Strong communication skills" }, sourceSection: "Requirements" },
      { type: "alternative", operator: "anyOf", values: ["Java", "Kotlin"], kind: "skill", classification: "required", evidence: { quote: "Java or Kotlin" }, sourceSection: "Requirements" },
    ],
  };
  const { result } = await run(text, response);
  assert.equal(result.metadata.company.value, "Example");
  assert.equal(result.items[0].kind, "responsibility");
  assert.equal(result.items[1].kind, "competency");
  assert.equal(result.items[2].type, "alternative");
});

test("merges semantic items without modifying deterministic extraction", async () => {
  const document = preprocess("Requirements\n- Experience with nodejs is required\nResponsibilities\n- You will mentor engineers");
  const deterministic = extract(document);
  const before = structuredClone(deterministic.extraction);
  const result = await semanticExtract(document, deterministic, () => ({
    items: [{ type: "item", value: "You will mentor engineers", kind: "responsibility", classification: "not-applicable", evidence: { quote: "You will mentor engineers" } }],
  }));
  assert.deepEqual(deterministic.extraction, before);
  assert.equal(result.items.length, 2);
});

for (const [name, response] of [
  ["unexpected fields", { items: [{ type: "item", value: "X", kind: "skill", classification: "required", evidence: { quote: "X" }, extra: true }] }],
  ["invalid classification", { items: [{ type: "item", value: "X", kind: "responsibility", classification: "required", evidence: { quote: "X" } }] }],
  ["malformed alternative", { items: [{ type: "alternative", operator: "allOf", values: ["A"], kind: "skill", classification: "required", evidence: { quote: "A" } }] }],
]) {
  test(`rejects semantic output: ${name}`, async () => {
    await assert.rejects(() => run("Requirements\n- X", response), /Invalid intermediate extraction/);
  });
}

test("rejects fabricated evidence", async () => {
  await assert.rejects(() => run("Requirements\n- X", { items: [{ type: "item", value: "X", kind: "skill", classification: "required", evidence: { quote: "Not in source" } }] }), /not present in source/);
});

test("writes intermediate callback only after schema and evidence validation", async () => {
  let calls = 0;
  const document = preprocess("Requirements\n- Node.js");
  const deterministic = extract(document);
  await semanticExtract(document, deterministic, () => ({ items: [{ type: "item", value: "Node.js", kind: "skill", classification: "required", evidence: { quote: "Node.js" } }] }), { onResponse: () => { calls += 1; } });
  assert.equal(calls, 1);
  await assert.rejects(() => semanticExtract(document, deterministic, () => ({ items: [{ type: "item", value: "AWS", kind: "skill", classification: "required", evidence: { quote: "AWS" } }] }), { onResponse: () => { calls += 1; } }));
  assert.equal(calls, 1);
});

test("rejects conflicting metadata and preserves ambiguity", async () => {
  const document = preprocess("Example Other");
  await assert.rejects(() => semanticExtract(document, { metadata: { company: { value: "Example", evidence: { quote: "Example" } } }, items: [] }, () => ({ metadata: { company: { value: "Other", evidence: { quote: "Other" } } }, items: [] })), /Conflicting semantic metadata/);
  const { result } = await run("Requirements\n- Modern cloud experience", { items: [{ type: "item", value: "Modern cloud experience", kind: "ambiguous", classification: "ambiguous", evidence: { quote: "Modern cloud experience" } }] });
  assert.equal(result.items[0].classification, "ambiguous");
});

test("rejects provider contract violations", async () => {
  await assert.rejects(() => semanticExtract(null, { items: [] }, () => ({ items: [] })), TypeError);
  await assert.rejects(() => semanticExtract(preprocess("X"), { items: [] }, null), TypeError);
});
