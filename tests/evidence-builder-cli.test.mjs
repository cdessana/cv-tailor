import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv from "ajv";
import { createCandidate } from "../lib/evidence/builder.mjs";
import { runEvidenceBuilder } from "../scripts/build-evidence.mjs";

const resume = {
  basics: { name: "CLI Candidate", email: "candidate@example.com" },
  skills: [{ name: "Backend", keywords: ["Node.js"] }],
  work: [{ name: "Example", position: "Engineer", startDate: "2021", highlights: ["Built Node.js APIs."] }],
};

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-builder-cli-"));
  await Promise.all(Object.entries(files).map(([name, value]) => fs.writeFile(path.join(root, name), typeof value === "string" ? value : JSON.stringify(value))));
  return { root, path: (name) => path.join(root, name), close: () => fs.rm(root, { recursive: true, force: true }) };
}

function captureBuild(captured) {
  return async (input) => {
    captured.push(input);
    const result = createCandidate(input.resume, { sourceReference: input.sourceReference, supportingSources: input.supportingSources });
    return { ...result, paths: {} };
  };
}

test("CLI accepts a direct list of supporting source references", async () => {
  const files = await fixture({ "resume.json": resume, "sources.json": [{ type: "linkedin", reference: "linkedin:example" }, { type: "github", reference: "github:example/project" }] });
  try {
    const captured = [];
    await runEvidenceBuilder([files.path("resume.json"), "--sources", files.path("sources.json")], { build: captureBuild(captured) });
    assert.deepEqual(captured[0].supportingSources, [{ type: "linkedin", reference: "linkedin:example" }, { type: "github", reference: "github:example/project" }]);
  } finally { await files.close(); }
});

test("CLI accepts the wrapped supportingSources payload and delegates source validation to the builder", async () => {
  const contextId = createCandidate(resume).candidate.contexts[0].id;
  const files = await fixture({ "resume.json": resume, "sources.json": { supportingSources: [{ type: "feedback", reference: "feedback:manager", claims: [{ contextId, claim: "Maintained APIs." }] }] } });
  try {
    const captured = [];
    const result = await runEvidenceBuilder([files.path("resume.json"), "--sources", files.path("sources.json")], { build: captureBuild(captured) });
    assert.equal(result.candidate.claims.some((claim) => claim.claim === "Maintained APIs."), true);
    assert.equal(captured[0].supportingSources[0].type, "feedback");
  } finally { await files.close(); }
});

test("CLI rejects malformed source arguments and payloads before building", async () => {
  const files = await fixture({ "resume.json": resume, "invalid.json": "not-json", "shape.json": { sources: [] } });
  try {
    await assert.rejects(() => runEvidenceBuilder([files.path("resume.json"), "--unknown" ]), /Unknown argument/);
    await assert.rejects(() => runEvidenceBuilder([files.path("resume.json"), "--sources"]), /requires a JSON file path/);
    await assert.rejects(() => runEvidenceBuilder([files.path("resume.json"), "--sources", files.path("shape.json"), "--sources", files.path("shape.json")]), /only once/);
    await assert.rejects(() => runEvidenceBuilder([files.path("resume.json"), "--sources", files.path("invalid.json")]), SyntaxError);
    await assert.rejects(() => runEvidenceBuilder([files.path("resume.json"), "--sources", files.path("shape.json")]), /supportingSources array/);
  } finally { await files.close(); }
});

test("CLI keeps source-type and context checks inside the evidence builder", async () => {
  const files = await fixture({ "resume.json": resume, "sources.json": [{ type: "unsupported", reference: "source:bad" }] });
  try {
    await assert.rejects(() => runEvidenceBuilder([files.path("resume.json"), "--sources", files.path("sources.json")], { build: captureBuild([]) }), (error) => error.code === "EVIDENCE_SOURCE_CONTRACT_INVALID");
  } finally { await files.close(); }
});

test("supporting-source schema accepts the runnable references example and rejects undeclared fields", async () => {
  const schema = JSON.parse(await fs.readFile(new URL("../schemas/evidence-sources.schema.json", import.meta.url), "utf8"));
  const example = JSON.parse(await fs.readFile(new URL("../examples/evidence-sources.references.json", import.meta.url), "utf8"));
  const validate = new Ajv().compile(schema);
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.equal(validate([{ type: "github", reference: "github:example", unexpected: true }]), false);
});
