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
        { type: "item", value: "You will mentor engineers", kind: "responsibility", classification: "not-applicable", evidence: { quote: "You will mentor engineers" }, sourceSection: "Responsibilities" },
        { type: "item", value: "Strong communication and leadership skills", kind: "competency", classification: "required", evidence: { quote: "Strong communication and leadership skills" }, sourceSection: "Requirements" },
      ],
    }),
  });
  assert.equal(result.job.responsibilities[0], "You will mentor engineers");
  const analysis = await analyze(output, directory);
  assert.equal(analysis.code, 0, analysis.stderr);
});

test("narrow semantic decisions derive source-grounded records locally", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, [
    "Example is hiring a Senior Engineer",
    "Requirements",
    "Good knowledge of Unix, SQL and scripting languages",
  ].join("\n"));
  const result = await runJobParser({
    input,
    output,
    semanticProvider: ({ unresolved }) => ({
      decisions: [{ unitId: unresolved[0].unit.id, action: "requirement" }],
    }),
  });
  assert.deepEqual(result.job.requirements.required, ["Good knowledge of Unix, SQL and scripting languages"]);
});

test("narrow semantic decisions preserve an Activities qualification without inventing strength", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "activities-decision.txt");
  const output = path.join(directory, "activities-decision.json");
  await fs.writeFile(input, [
    "Example is hiring a Senior Engineer",
    "Activities",
    "Good knowledge of Unix, SQL and scripting languages",
  ].join("\n"));
  const result = await runJobParser({
    input,
    output,
    semanticProvider: ({ unresolved }) => ({
      decisions: [{ unitId: unresolved[0].unit.id, action: "requirement" }],
    }),
  });
  assert.deepEqual(
    result.job.qualifications,
    ["Good knowledge of Unix, SQL and scripting languages"]
  );
  assert.equal(result.job.requirements, undefined);
});

test("narrow semantic alternatives retain source classification and evidence locally", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "alternative-decision.txt");
  const output = path.join(directory, "alternative-decision.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nRequirements\nExperience with Java or Kotlin");
  const result = await runJobParser({
    input,
    output,
    semanticProvider: ({ unresolved }) => ({
      decisions: [{ unitId: unresolved[0].unit.id, action: "alternative", values: ["Java", "Kotlin"] }],
    }),
  });
  assert.deepEqual(result.job.alternativeRequirements[0].values, ["Java", "Kotlin"]);
});

test("narrow metadata decisions derive evidence and source references locally", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "metadata-decision.txt");
  const output = path.join(directory, "metadata-decision.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\n\nJob location: London");
  const result = await runJobParser({
    input,
    output,
    semanticProvider: ({ unresolved }) => ({ decisions: [{
      unitId: unresolved[0].unit.id,
      action: "metadata",
      metadataKey: "location",
      value: "London",
    }] }),
  });
  assert.equal(result.job.location, "London");
});

test("lossless explicit alternatives parse without semantic enrichment", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "raw.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nRequirements\n- AWS or GCP, Azure", "utf8");
  const result = await command([path.join(root, "scripts/job-parser.mjs"), input, "--output", output], directory);
  assert.equal(result.code, 0, result.stderr);
  const job = JSON.parse(await fs.readFile(output, "utf8"));
  assert.deepEqual(job.requirements.required, ["AWS or GCP, Azure"]);
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

test("ambiguous wording remains a usable structural parse when enrichment is unavailable", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/ambiguous.txt");
  const output = path.join(directory, "ambiguous.json");
  const result = await command([path.join(root, "scripts/job-parser.mjs"), input, "--output", output], directory);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(await fs.readFile(`${output}.report.json`, "utf8"));
  assert.ok(report.warnings.some((warning) => warning.code === "semantic_enrichment_unavailable"));
});

test("malformed semantic output degrades to a structural parse with a warning", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/malformed-semantic.txt");
  const output = path.join(directory, "malformed.json");
  const result = await runJobParser({
    input,
    output,
    semanticProvider: () => ({ items: [{ type: "item", value: "Communication", kind: "competency", classification: "required", evidence: { quote: "Strong communication and leadership skills" }, extra: true }] }),
  });
  assert.ok(result.warnings.some((warning) => warning.code === "semantic_enrichment_failed"));
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result.job);
});

test("semantic timeout degrades to a structural parse with a warning", async () => {
  const directory = await tempDir();
  const input = path.join(directory, "timeout.txt");
  const output = path.join(directory, "timeout.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nCandidate profile\n- Modern cloud experience");
  const result = await runJobParser({
    input,
    output,
    semanticProvider: async () => {
      throw Object.assign(new Error("Semantic provider timed out."), { code: "OLLAMA_TIMEOUT" });
    },
  });
  assert.ok(result.warnings.some((warning) => warning.code === "semantic_enrichment_failed"));
  assert.equal(result.job.company, "Example");
  assert.equal(result.diagnostics.unresolved.length, 1);
  await fs.access(output);
});

test("hallucinated semantic enrichment is rejected while structural output survives", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/hallucinated.txt");
  const output = path.join(directory, "hallucinated.json");
  const result = await runJobParser({
    input,
    output,
    semanticProvider: () => ({ items: [{ type: "item", value: "AWS", kind: "skill", classification: "required", evidence: { quote: "Experience with AWS is required" } }] }),
  });
  assert.ok(result.warnings.some((warning) => warning.code === "semantic_enrichment_failed"));
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result.job);
});

test("explicit structured alternatives remain lossless until optional enrichment", async () => {
  const directory = await tempDir();
  const input = path.join(root, "test/fixtures/jobs/raw/alternative.txt");
  const output = path.join(directory, "alternative.json");
  const result = await runJobParser({
    input,
    output,
    semanticProvider: () => ({
      metadata: { company: { value: "Example", evidence: { quote: "Example is hiring a Senior Engineer" } }, title: { value: "Senior Engineer", evidence: { quote: "Example is hiring a Senior Engineer" } } },
      items: [{ type: "alternative", operator: "anyOf", values: ["AWS", "GCP"], kind: "skill", classification: "required", evidence: { quote: "AWS or GCP" } }],
    }),
  });
  assert.deepEqual(result.job.requirements.required, ["AWS or GCP"]);
  assert.equal(result.job.alternativeRequirements, undefined);
  const analysis = await analyze(output, directory);
  assert.equal(analysis.code, 0, analysis.stderr);
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
  test(`unsupported location enrichment is discarded with a warning: ${quote}`, async (t) => {
    const directory = await tempDir();
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const input = path.join(directory, "job.txt");
    const output = path.join(directory, "job.json");
    await fs.writeFile(input, "Example is hiring an Engineer\n\nJob location: Osasco");
    const result = await runJobParser({ input, output, semanticProvider: () => ({
      items: [], metadata: { location: { value: "London", evidence: { quote } } },
    }) });
    assert.ok(result.warnings.some((warning) => warning.code === "semantic_enrichment_failed"));
    await fs.access(output);
  });
}

test("alternative analysis counts a selected option once and tailoring accepts it", async (t) => {
  const directory = await tempDir();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "source.txt");
  const output = path.join(directory, "job.json");
  const source = "Example is hiring an Engineer\n\nNode.js or NeverSeenTechnology\nPrefer Node.js or Kubernetes";
  await fs.writeFile(input, source);
  await runJobParser({ input, output, semanticProvider: () => ({ items: [
    { type: "alternative", operator: "anyOf", kind: "skill", classification: "required", values: ["Node.js", "NeverSeenTechnology"], evidence: { quote: "Node.js or NeverSeenTechnology" } },
    { type: "alternative", operator: "anyOf", kind: "skill", classification: "preferred", values: ["Node.js", "Kubernetes"], evidence: { quote: "Prefer Node.js or Kubernetes" } },
  ] }) });
  const analyzed = await analyze(output, directory);
  assert.equal(analyzed.code, 0, analyzed.stderr);
  const reportPath = path.join(directory, "output/example-engineer-analysis.json");
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const matches = [...report.matches.strong, ...report.matches.related, ...report.matches.missing];
  assert.equal(matches.length, 2);
  assert.equal(matches.filter((item) => item.category === "required").length, 1);
  assert.equal(matches.filter((item) => item.category === "preferred").length, 1);
  assert.ok(matches.every((item) => item.alternative));
  assert.ok(matches.every((item) => item.term !== "NeverSeenTechnology"));
  const tailored = await command([path.join(root, "scripts/tailor.mjs"), resume, reportPath, aliases, evidence], directory);
  assert.equal(tailored.code, 0, tailored.stderr);
});
