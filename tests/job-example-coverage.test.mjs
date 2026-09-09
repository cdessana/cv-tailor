import test from "node:test";
import assert from "node:assert/strict";
import { validateExampleCoverage } from "../lib/job-parser/example-coverage.mjs";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";

const item = (value, quote, examples = []) => ({ type: "item", kind: "requirement", classification: "preferred", value, evidence: { quote }, ...(examples.length ? { examples: examples.map(value => ({ value })) } : {}) });

for (const [value, quote, missing] of [
  ["UI frameworks", "UI frameworks (such as React or Angular) to support the rewrite.", ["React", "Angular"]],
  ["Containerization", "Containerization (e.g., Docker, Kubernetes).", ["Docker", "Kubernetes"]],
  ["Version control", "Version control (e.g., Git).", ["Git"]],
  ["Ferramentas", "Ferramentas (por exemplo, Docker e Kubernetes).", ["Docker", "Kubernetes"]],
  ["Languages", "Languages (such as C++, C#, or Node.js).", ["C++", "C#", "Node.js"]],
]) test(`detects omitted examples: ${quote}`, () => {
  const record = item(value, quote);
  const before = structuredClone(record);
  assert.deepEqual(validateExampleCoverage(record)[0].missing, missing);
  assert.deepEqual(record, before);
  assert.deepEqual(validateExampleCoverage(item(value, quote, missing)), []);
});

test("partial lists expose only missing examples", () => {
  assert.deepEqual(validateExampleCoverage(item("Frameworks", "Frameworks (such as React or Angular)", ["React"]))[0].missing, ["Angular"]);
});

test("does not infer examples from choices, conjunctions, unrelated quotes or retained lists", () => {
  for (const record of [
    item("Java or Kotlin", "Java or Kotlin"),
    item("Snowflake, relational, and non-relational databases", "Snowflake, relational, and non-relational databases"),
    item("Java", "Java required. Frameworks (such as React or Angular) preferred."),
    item("Frameworks (such as React or Angular)", "Frameworks (such as React or Angular)"),
    item("Frameworks", "Frameworks (such as React (version 18) or Angular)"),
  ]) assert.deepEqual(validateExampleCoverage(record), []);
});

test("requires a short primarily/mainly technology qualifier to remain in value", () => {
  const quote = "Experiência com soluções em Cloud, principalmente AWS.";
  const shortened = item("Experiência com soluções em Cloud", quote);
  assert.equal(validateExampleCoverage(shortened)[0].code, "missing_illustrative_qualifier");
  const shortenedWithExample = item("Experiência com soluções em Cloud", quote, ["AWS"]);
  assert.equal(validateExampleCoverage(shortenedWithExample)[0].code, "missing_illustrative_qualifier");
  const retained = item("Experiência com soluções em Cloud, principalmente AWS", quote, ["AWS"]);
  assert.deepEqual(validateExampleCoverage(retained), []);
});

test("AgileEngine headings receive deterministic signals with source offsets intact", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = ["What you will do ", "Build products", "", "Must haves", "Java experience", "", "Nice to haves", "Cloud experience"].join(newline);
    const document = preprocess(source);
    assert.deepEqual(document.sections.map(section => section.signal), ["responsibilities", "required", "preferred"]);
    for (const section of document.sections) {
      assert.equal(source.slice(section.heading.start, section.heading.end), section.heading.originalText);
      assert.equal(section.units.length, 1);
    }
  }
});

for (const corrected of [true, false]) test(`Gemini omission correction ${corrected ? "preserves examples" : "fails explicitly when still missing"}`, async () => {
  const document = preprocess("UI frameworks (such as React or Angular)");
  const id = document.sections[0].units[0].id;
  let calls = 0;
  const provider = createGeminiProvider({ apiKey: "test", logger: {}, fetchImpl: async (_url, options) => {
    calls++;
    if (calls === 2) {
      assert.match(options.body, /missing_examples/);
      assert.match(options.body, /Angular/);
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: {
      name: "extract_block", args: { id, status: "extracted", reason: "", metadata: {}, alternatives: [],
        items: [item("UI frameworks", document.originalText, corrected && calls === 2 ? ["React", "Angular"] : [])] },
    } }] } }] }) };
  } });
  if (corrected) {
    const result = await provider(document);
    assert.deepEqual(result.items[0].examples, [{ value: "React" }, { value: "Angular" }]);
  } else await assert.rejects(provider(document), /missing_examples/);
  assert.equal(calls, corrected ? 2 : 3);
});
