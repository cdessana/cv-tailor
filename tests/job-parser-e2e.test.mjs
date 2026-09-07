import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { runJobParser } from "../scripts/job-parser.mjs";

const root = path.resolve(".");
const resume = path.join(root, "data/resumes/base.json");
const aliases = path.join(root, "data/aliases.json");
const evidence = path.join(root, "data/evidence.json");

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "job-parser-e2e-"));
}

function command(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function analyze(jobPath, cwd) {
  return command([
    path.join(root, "scripts/analyse.mjs"),
    resume,
    jobPath,
    aliases,
    evidence,
  ], cwd);
}

test("parses a representative deterministic JD and feeds analyse without edits", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/deterministic.txt");
  const output = path.join(directory, "parsed.json");
  const parsed = await command([path.join(root, "scripts/job-parser.mjs"), "--input", input, "--output", output], directory);
  assert.equal(parsed.code, 0, parsed.stderr);
  const job = JSON.parse(await fs.readFile(output, "utf8"));
  assert.deepEqual(job.requirements.required, ["Node.js"]);
  assert.deepEqual(job.requirements.preferred, ["Kubernetes"]);
  const analysis = await analyze(output, directory);
  assert.equal(analysis.code, 0, analysis.stderr);
  const analysisPath = path.join(directory, "output", "example-senior-engineer-analysis.json");
  const report = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  assert.equal(report.job.title, "Senior Engineer");
  assert.equal(report.matches.strong.some((item) => item.term === "Node.js"), true);
  assert.equal([...report.matches.strong, ...report.matches.related, ...report.matches.missing].some((item) => item.term === "Kubernetes"), true);
});

test("semantic provider output maps and feeds analyse directly", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/semantic.txt");
  const output = path.join(directory, "semantic.json");
  const result = await runJobParser({
    input,
    output,
    semanticProvider: () => ({
      metadata: {
        company: { value: "Example", evidence: { quote: "Example is hiring a Senior Engineer" } },
        title: { value: "Senior Engineer", evidence: { quote: "Example is hiring a Senior Engineer" } },
      },
      items: [
        { type: "item", value: "Mentor engineers", kind: "responsibility", classification: "not-applicable", evidence: { quote: "You will mentor engineers" }, sourceSection: "Responsibilities" },
        { type: "item", value: "Communication", kind: "competency", classification: "required", evidence: { quote: "Strong communication and leadership skills" }, sourceSection: "Requirements" },
      ],
    }),
  });
  assert.equal(result.job.responsibilities[0], "Mentor engineers");
  const analysis = await analyze(output, directory);
  assert.equal(analysis.code, 0, analysis.stderr);
});

test("unresolved and unrepresentable cases fail without accepted output", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "raw.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nRequirements\n- AWS or GCP", "utf8");
  const result = await command([path.join(root, "scripts/job-parser.mjs"), input, "--output", output], directory);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SEMANTIC_ERROR|MAPPING_ERROR/);
  await assert.rejects(() => fs.access(output));
});

test("missing metadata fails explicitly without accepted output", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/missing-metadata.txt");
  const output = path.join(directory, "missing-metadata.json");
  const result = await command([path.join(root, "scripts/job-parser.mjs"), input, "--output", output], directory);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /MAPPING_ERROR/);
  await assert.rejects(() => fs.access(output));
});

test("ambiguous wording fails conservatively without a semantic provider", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/ambiguous.txt");
  const output = path.join(directory, "ambiguous.json");
  const result = await command([path.join(root, "scripts/job-parser.mjs"), input, "--output", output], directory);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SEMANTIC_ERROR/);
  await assert.rejects(() => fs.access(output));
});

test("malformed semantic output is rejected before writing", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/malformed-semantic.txt");
  const output = path.join(directory, "malformed.json");
  await assert.rejects(() => runJobParser({
    input,
    output,
    semanticProvider: () => ({ items: [{ type: "item", value: "Communication", kind: "competency", classification: "required", evidence: { quote: "Strong communication and leadership skills" }, extra: true }] }),
  }), /SEMANTIC_ERROR/);
  await assert.rejects(() => fs.access(output));
});

test("hallucinated semantic extraction fails evidence validation", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/hallucinated.txt");
  const output = path.join(directory, "hallucinated.json");
  await assert.rejects(() => runJobParser({
    input,
    output,
    semanticProvider: () => ({ items: [{ type: "item", value: "AWS", kind: "skill", classification: "required", evidence: { quote: "Experience with AWS is required" } }] }),
  }), /SEMANTIC_ERROR/);
  await assert.rejects(() => fs.access(output));
});

test("explicit alternatives fail at compatibility mapping rather than becoming AND", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/alternative.txt");
  const output = path.join(directory, "alternative.json");
  await assert.rejects(() => runJobParser({
    input,
    output,
    semanticProvider: () => ({
      metadata: { company: { value: "Example", evidence: { quote: "Example is hiring a Senior Engineer" } }, title: { value: "Senior Engineer", evidence: { quote: "Example is hiring a Senior Engineer" } } },
      items: [{ type: "alternative", operator: "anyOf", values: ["AWS", "GCP"], kind: "skill", classification: "required", evidence: { quote: "AWS or GCP" } }],
    }),
  }), /MAPPING_ERROR/);
  await assert.rejects(() => fs.access(output));
});

test("manually authored fixture remains consumable by analyse", async () => {
  const directory = await tempDir();
  const fixture = path.join(root, "data/jobs/flash-senior-backend.json");
  const analysis = await analyze(fixture, directory);
  assert.equal(analysis.code, 0, analysis.stderr);
});

for (const location of [undefined, "Osasco, SP", "Osasco (SP), Recife (PE)"]) {
  test(`location survives parser and analyse: ${location}`, async (t) => {
    const directory = await tempDir();
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const input = path.join(directory, "job.txt");
    const output = path.join(directory, "job.json");
    await fs.writeFile(input, `Example is hiring an Engineer\n\nJob location: ${location ?? "unspecified"}\nRequirements\n- Node.js`);
    const result = await runJobParser({ input, output, semanticProvider: () => ({
      items: [],
      ...(location === undefined ? {} : { metadata: { location: { value: location, evidence: { quote: `Job location: ${location}` } } } }),
    }) });
    assert.equal(Object.hasOwn(result.job, "location"), location !== undefined);
    assert.equal(result.job.location, location);
    assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result.job);
    const analysis = await analyze(output, directory);
    assert.equal(analysis.code, 0, analysis.stderr);
  });
}

for (const quote of ["Job location: London", "Job location: Osasco"]) {
  test(`unsupported location blocks output with evidence ${quote}`, async (t) => {
    const directory = await tempDir();
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const input = path.join(directory, "job.txt");
    const output = path.join(directory, "job.json");
    await fs.writeFile(input, "Example is hiring an Engineer\n\nJob location: Osasco");
    await assert.rejects(runJobParser({ input, output, semanticProvider: () => ({
      items: [], metadata: { location: { value: "London", evidence: { quote } } },
    }) }), /evidence validation failed/);
    await assert.rejects(fs.access(output), { code: "ENOENT" });
  });
}
