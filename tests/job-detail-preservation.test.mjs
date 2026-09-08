import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import Ajv from "ajv";
import { assertExtraction } from "../lib/job-parser/extraction-contract.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";
import { runJobParser } from "../scripts/job-parser.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";

const record = value => ({ value, evidence: { quote: value } });
const metadata = { company: record("AgileEngine"), title: record("Senior Software Engineer") };
const item = (value, examples = [], classification = "preferred", quote = value) => ({
  type: "item", kind: "requirement", classification, value, evidence: { quote },
  ...(examples.length ? { examples: examples.map(value => ({ value })) } : {}),
});

test("examples are strict optional fields and every example must be grounded", () => {
  const valid = item("Containerization", ["k8s"], "preferred", "Containerization (e.g., k8s)");
  const extraction = { items: [valid] };
  const document = { originalText: valid.evidence.quote };
  assert.equal(validateEvidence(document, extraction).valid, true);
  const normalized = normalizeExtraction(extraction);
  assert.deepEqual(normalized.items[0].examples, [{ value: "Kubernetes" }]);
  assert.equal(extraction.items[0].examples[0].value, "k8s");
  assert.equal(validateEvidence(document, normalized).valid, true);
  const fabricated = structuredClone(extraction);
  fabricated.items[0].examples[0].value = "Docker";
  assert.equal(validateEvidence(document, fabricated).errors[0].path, "/items/0/examples/0/value");
  for (const examples of [null, [], ["k8s"], [{ value: "" }], [{ value: "k8s", inferred: true }]]) {
    assert.throws(() => assertExtraction({ items: [{ ...valid, examples }] }));
  }
  const unknown = normalizeExtraction({ items: [item("Tools", ["UnknownTool"], "preferred", "Tools e.g. UnknownTool")] });
  assert.equal(unknown.items[0].examples[0].value, "UnknownTool");
});

test("equivalent duplicates preserve examples, while durations and classifications remain distinct", async () => {
  const quote = "Frameworks (such as React, Angular)";
  const extraction = await semanticExtract({ originalText: `${quote}\n4+ years Java\nJava` }, { items: [] }, async () => ({ items: [
    item("Frameworks", ["React"], "preferred", quote),
    item("Frameworks", ["Angular"], "preferred", quote),
    item("4+ years Java", [], "required"), item("Java", [], "required"), item("Java", [], "preferred"),
  ] }));
  assert.equal(extraction.items.length, 4);
  assert.deepEqual(extraction.items[0].examples, [{ value: "React" }, { value: "Angular" }]);
});

test("work arrangement candidates retain human-review warnings and grounding", () => {
  const workArrangement = { ...record("Remote"), candidates: [record("Remote"), record("Hybrid")] };
  const extraction = { metadata: { ...metadata, workArrangement }, items: [] };
  assert.equal(validateEvidence({ originalText: "AgileEngine Senior Software Engineer Remote Hybrid" }, extraction).valid, true);
  const mapped = mapToJob(extraction);
  assert.equal(mapped.job.remote, "Remote");
  assert.equal(mapped.warnings[0].requiresHumanValidation, true);
  assert.equal(validateEvidence({ originalText: "AgileEngine Senior Software Engineer Remote" }, extraction).valid, false);
});

test("Gemini wire schema and block coverage retain examples and perks metadata", async () => {
  const document = preprocessJobDescription("Frameworks (such as React or Angular)\n\nwork 100% remotely");
  const units = document.sections.flatMap(section => section.units);
  const provider = createGeminiProvider({ apiKey: "test", logger: {}, fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(JSON.stringify(request), /Language proficiency and minimum language levels are requirements/);
    assert.match(JSON.stringify(request), /Inspect benefits\/perks/);
    const parts = units.map((unit, index) => ({ functionCall: { name: "extract_block", args: {
      id: unit.id, status: "extracted", reason: "", alternatives: [],
      items: index === 0 ? [item("Frameworks", ["React", "Angular"], "preferred", unit.originalText)] : [],
      metadata: index === 1 ? { workArrangement: record(unit.originalText) } : {},
    } } }));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts } }] }) };
  } });
  const extraction = await provider(document);
  assert.equal(extraction.metadata.workArrangement.value, "work 100% remotely");
  assert.deepEqual(extraction.items[0].examples.map(example => example.value), ["React", "Angular"]);
  assert.ok(extraction.coverage.some(entry => entry.metadataKeys?.includes("workArrangement")));
});

test("parser output preserves details and analyse consumes it without treating examples as requirements", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-details-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const items = [
    item("Upper-Intermediate English level", [], "required"),
    item("Snowflake, relational, and non-relational databases", [], "required"),
    item("Proficiency in version control systems", ["Git"], "required", "Proficiency in version control systems (e.g., Git)."),
    item("Familiarity with modern component-based UI frameworks", ["React", "Angular"], "preferred", "Familiarity with modern component-based UI frameworks (such as React or Angular)."),
    item("Understanding of cloud architecture and containerization", ["Docker", "Kubernetes"], "preferred", "Understanding of cloud architecture and containerization (e.g., Docker, Kubernetes)."),
  ];
  const input = path.join(directory, "raw.txt"), output = path.join(directory, "job.json");
  await fs.writeFile(input, ["AgileEngine", "Senior Software Engineer", ...items.map(item => item.evidence.quote), "work 100% remotely with flexible hours"].join("\n\n"));
  const { job } = await runJobParser({ input, output, semanticProvider: async () => ({
    metadata: { ...metadata, workArrangement: { value: "work 100% remotely", evidence: { quote: "work 100% remotely with flexible hours" } } }, items,
  }) });
  assert.deepEqual(job.requirements.required, items.slice(0, 3).map(item => item.value));
  assert.deepEqual(job.requirements.preferred, items.slice(3).map(item => item.value));
  assert.equal(job.remote, "work 100% remotely");
  assert.equal(job.alternativeRequirements, undefined);
  assert.equal(job.requirementExamples.length, 3);
  const root = process.cwd();
  await promisify(execFile)(process.execPath, [path.join(root, "scripts/analyse.mjs"), path.join(root, "data/resumes/base.json"), output, path.join(root, "data/aliases.json"), path.join(root, "data/evidence.json")], { cwd: directory });
  const schema = JSON.parse(await fs.readFile(new URL("../schemas/job.schema.json", import.meta.url)));
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.equal(validate(job), true);
  for (const values of [[], [23], [""], ["Git", "Git"]]) {
    const malformed = structuredClone(job);
    malformed.requirementExamples[0].values = values;
    assert.equal(validate(malformed), false);
  }
});
