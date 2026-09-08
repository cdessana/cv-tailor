import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidence, restoreSourceCase } from "../lib/job-parser/validate-evidence.mjs";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";

const record = (value, quote = value) => ({ value, evidence: { quote } });
const item = (value, quote = value) => ({ type: "item", kind: "requirement", classification: "required", ...record(value, quote) });
const block = (items = [], metadata = {}) => ({ status: "extracted", reason: "", items, alternatives: [], metadata });
async function run(source, result) {
  const document = preprocess(source);
  const id = document.sections[0].units[0].id;
  const payload = { candidates: [{ content: { parts: [{ functionCall: { name: "extract_block", args: { id, ...result } } }] } }] };
  const snapshot = structuredClone(payload), raw = [], warnings = [];
  let calls = 0;
  const provider = createGeminiProvider({ apiKey: "test", logger: { warn: x => warnings.push(x) }, onRawResponse: x => raw.push(x),
    fetchImpl: async () => { calls++; return { status: 200, ok: true, json: async () => payload }; } });
  const extraction = await provider(document);
  assert.deepEqual(payload, snapshot);
  assert.deepEqual(JSON.parse(raw[0]), snapshot);
  return { extraction, warnings, calls };
}

test("Ninja: literal quote in glued text supports geographic value", async () => {
  const { extraction, calls } = await run("Engineering & Quality AssuranceRemote, Brazil", block([], { location: record("Brazil", "Remote, Brazil") }));
  assert.equal(extraction.metadata.location.value, "Brazil");
  assert.equal(calls, 1);
});

test("quote matching does not permit extracting technology fragments", () => {
  for (const [source, value] of [["JavaScript", "Java"], ["C++", "C"], [".NET", "NET"], ["Node.js", "Node"]]) {
    assert.equal(validateEvidence({ originalText: source }, { items: [item(value)] }).valid, false);
  }
  assert.equal(validateEvidence({ originalText: "Java experience" }, { items: [item("Java", "Java is required")] }).valid, false);
});

test("Reap: restores source capitalization without a correction request", async () => {
  const source = "You have experience working on backend systems.";
  const { extraction, calls } = await run(source, block([item("Experience working on backend systems", source)]));
  assert.equal(extraction.items[0].value, "experience working on backend systems");
  assert.equal(calls, 1);
});

test("Portuguese casing and alternative options use source spelling", async () => {
  const source = "Você tem experiência em APIs REST ou GraphQL.";
  const result = block([item("Experiência em APIs", source)]);
  result.alternatives = [{ type: "alternative", kind: "skill", classification: "required", operator: "anyOf", values: ["rest", "graphql"], evidence: { quote: source } }];
  const { extraction } = await run(source, result);
  assert.equal(extraction.items[0].value, "experiência em APIs");
  assert.deepEqual(extraction.items[1].values, ["REST", "GraphQL"]);
});

for (const [value, quote] of [
  ["Build and operate services", "builds and operates services"],
  ["participar das decisões", "participe das decisões"],
  ["Conhecimento em observabilidade", "Conhecimento em mensageria e observabilidade"],
  ["JAVA", "JavaScript"],
]) test(`case restoration does not rewrite ${value}`, () => assert.equal(restoreSourceCase(value, quote), value));

test("Skeelo: retains grounded records from contradictory excluded blocks", async () => {
  const result = { ...block([item("Java experience")]), status: "excluded", reason: "No records" };
  const { extraction, warnings, calls } = await run("Java experience", result);
  assert.equal(calls, 1);
  assert.equal(extraction.items[0].value, "Java experience");
  assert.equal(extraction.coverage[0].status, "extracted");
  assert.ok(warnings.some(x => /block_status_corrected/.test(x)));
});

for (const [name, result] of [
  ["unsupported value", { ...block([item("Kubernetes", "Java experience")]), status: "excluded" }],
  ["fabricated evidence", { ...block([item("Java", "Java is required")]), status: "excluded" }],
  ["invalid classification", { ...block([{ ...item("Java experience"), kind: "responsibility" }]), status: "excluded" }],
  ["empty substantive block", block()],
  ["unresolved block", { ...block([item("Java experience")]), status: "unresolved", reason: "Uncertain meaning" }],
]) test(`reconciliation still rejects ${name}`, async () => {
  await assert.rejects(run("Java experience", result), /GEMINI_SCHEMA_ERROR/);
});
