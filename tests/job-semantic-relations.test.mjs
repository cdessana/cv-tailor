import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { validateItemSemantics } from "../lib/job-parser/validate-item-semantics.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";

const record = value => ({ value, evidence: { quote: value } });
const metadata = { company: record("Example"), title: record("Engineer") };
const ordinary = (value, quote = value) => ({ type: "item", kind: "requirement", classification: "required", value, evidence: { quote } });
const alternative = (values, quote) => ({ type: "alternative", operator: "anyOf", kind: "skill", classification: "required", values, evidence: { quote } });
const fixtures = JSON.parse(await fs.readFile(new URL("../test/fixtures/jobs/semantic-relations.json", import.meta.url)));

for (const fixture of fixtures) test(fixture.name, async () => {
  const bad = fixture.options ? alternative(fixture.options, fixture.quote) : ordinary(fixture.value, fixture.quote);
  const before = structuredClone(bad);
  assert.ok(validateItemSemantics(bad).some(error => error.code === fixture.error));
  assert.equal(mapToJob({ metadata, items: [bad] }).valid, false);
  assert.deepEqual(bad, before);
  const good = ordinary(fixture.quote);
  assert.deepEqual(validateItemSemantics(good), []);
  assert.equal(mapToJob({ metadata, items: [good] }).valid, true);
  const document = preprocess(fixture.quote);
  const id = document.sections[0].units[0].id;
  let attempts = 0;
  const provider = createGeminiProvider({ apiKey: "test", logger: {}, fetchImpl: async (_url, options) => {
    attempts++;
    if (attempts === 2) assert.ok(options.body.includes(fixture.error));
    const current = attempts === 1 ? bad : good;
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: {
      name: "extract_block", args: { id, status: "extracted", reason: "", metadata: {},
        items: current.type === "item" ? [current] : [], alternatives: current.type === "alternative" ? [current] : [] },
    } }] } }] }) };
  } });
  const result = await provider(document);
  assert.equal(attempts, 2);
  assert.equal(result.items[0].value, fixture.quote);
});

test("AgileEngine illustration within value is accepted by the provider and mapper", () => {
  const item = ordinary("Familiarity with modern component-based UI frameworks (such as React or Angular) to support the TypeScript rewrite");
  assert.deepEqual(validateItemSemantics(item), []);
  assert.equal(mapToJob({ metadata, items: [item] }).valid, true);
  assert.equal(validateItemSemantics(ordinary("Java or Kotlin and UI frameworks (such as React or Angular)"))[0].code, "unstructured_alternative");
});

test("non-parenthetical illustrative lists do not become alternatives or unresolved choices", () => {
  const item = ordinary("base sólida em outras linguagens, como Java, C#, Python ou Node.js");
  assert.deepEqual(validateItemSemantics(item), []);
  assert.equal(mapToJob({ metadata, items: [item] }).valid, true);
  const alternativeItem = alternative(["Java", "C#", "Python", "Node.js"],
    "base sólida em outras linguagens, como Java, C#, Python ou Node.js");
  assert.equal(validateItemSemantics(alternativeItem)[0].code, "invalid_alternative");
});

test("real choices preserve open options and production qualifiers", () => {
  for (const item of [
    alternative(["Kafka", "RabbitMQ", "similares"], "Kafka, RabbitMQ ou similares"),
    alternative(["Go", "Kotlin"], "Experiência em produção com Go e/ou Kotlin"),
    alternative(["Java", "Kotlin"], "one of Java, Kotlin"),
    alternative(["PostgreSQL", "MySQL"], "postgres or MySQL"),
  ]) assert.deepEqual(validateItemSemantics(item), []);
});

test("identification repeated as requirements is rejected but actual role experience survives", () => {
  for (const key of ["company", "title"]) {
    const item = ordinary(metadata[key].value);
    assert.equal(validateItemSemantics(item, { metadata })[0].code, "metadata_as_requirement");
    assert.equal(mapToJob({ metadata, items: [item] }).valid, false);
  }
  assert.deepEqual(validateItemSemantics(ordinary("Engineer", "Experience as an Engineer"), { metadata }), []);
});

test("company stack context is not promoted to candidate preference", () => {
  const item = alternative(["Go", "Kotlin"], "No backend, utilizamos principalmente Go e Kotlin");
  assert.ok(validateItemSemantics(item).some(error => error.code === "context_not_qualification"));
  assert.deepEqual(validateItemSemantics(ordinary("Experiência com Go")), []);
});

test("work arrangement preserves hashtag and conditions without weakening technology boundaries", () => {
  const quote = "Somos #remotefirst - damos prioridade ao trabalho remoto sempre que a função permitir";
  const good = { items: [], metadata: { workArrangement: record("#remotefirst - damos prioridade ao trabalho remoto sempre que a função permitir") } };
  assert.equal(validateEvidence({ originalText: quote }, good).valid, true);
  const bad = { items: [], metadata: { workArrangement: record("remotefirst") } };
  bad.metadata.workArrangement.evidence.quote = quote;
  assert.equal(validateEvidence({ originalText: quote }, bad).valid, false);
  assert.equal(validateEvidence({ originalText: "JavaScript" }, { items: [ordinary("Java", "JavaScript")] }).valid, false);
});

test("work arrangement is metadata, not a preferred requirement", () => {
  const quote = "work 100% remotely with flexible hours";
  const extraction = { metadata: { ...metadata, workArrangement: record(quote) }, items: [
    { ...ordinary(quote), classification: "preferred" },
  ] };
  assert.equal(validateItemSemantics(extraction.items[0], { metadata: extraction.metadata })[0].code, "metadata_as_requirement");
  assert.equal(mapToJob(extraction).valid, false);
});

test("normalized aliases in examples remain accepted at the final semantic gate", () => {
  const item = { ...ordinary("Tools", "Tools (e.g., k8s)"), examples: [{ value: "Kubernetes" }] };
  assert.deepEqual(validateItemSemantics(item), []);
});
