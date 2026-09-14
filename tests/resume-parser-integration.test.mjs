import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { render } from "resumed";
import stackoverflowTheme from "jsonresume-theme-stackoverflow";
import { runResumeParser } from "../scripts/resume-parser.mjs";
import { validateResume } from "../lib/resume-parser/validate.mjs";

const root = path.resolve(".");
const fixture = path.join(root, "tests/fixtures/resume-parser/factual-resume.txt");
const job = path.join(root, "data/jobs/flash-senior-backend.json");
const aliases = path.join(root, "data/aliases.json");
const evidence = path.join(root, "data/evidence.json");

function command(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("generated resume is consumed by validation, analysis, tailoring, and HTML rendering", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-parser-integration-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const candidatePath = path.join(directory, "candidate.json");
  const analysisRoot = path.join(directory, "analysis");

  const parsed = await runResumeParser(
    { input: fixture, output: candidatePath },
    { loadConfiguration: () => ({ paths: { baseResume: path.join(directory, "base.json") } }) }
  );
  assert.equal(parsed.report.status, "ready");
  assert.equal(parsed.report.grounding.errors, 0);
  assert.equal(parsed.report.grounding.valuesChecked > 0, true);
  assert.equal(parsed.report.grounding.groundedValues, parsed.report.grounding.valuesChecked);
  const candidate = JSON.parse(await fs.readFile(candidatePath, "utf8"));
  assert.deepEqual(validateResume(candidate), { valid: true, errors: [] });

  const analyzed = await command([
    path.join(root, "scripts/analyse.mjs"),
    candidatePath,
    job,
    aliases,
    evidence,
    analysisRoot,
  ], directory);
  assert.equal(analyzed.code, 0, analyzed.stderr);
  const analysisPath = path.join(analysisRoot, "flash-engenheira-de-software-senior-analysis.json");
  const analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  assert.equal(analysis.matches.strong.some(({ term }) => term === "Node.js"), true);
  assert.equal(analysis.matches.strong.some(({ term }) => term === "MongoDB"), true);

  const tailored = await command([
    path.join(root, "scripts/tailor.mjs"),
    candidatePath,
    analysisPath,
    aliases,
    evidence,
  ], directory);
  assert.equal(tailored.code, 0, tailored.stderr);
  const tailoredPath = path.join(directory, "output/flash/resume.json");
  const tailoredResume = JSON.parse(await fs.readFile(tailoredPath, "utf8"));
  assert.equal(validateResume(tailoredResume).valid, true);

  const html = await render(candidate, stackoverflowTheme);
  assert.match(html, /Jane Doe/u);
  assert.match(html, /37%/u);
});
