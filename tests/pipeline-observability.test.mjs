import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runPipeline } from "../server/services/pipeline-service.mjs";

const jobPath = "data/jobs/flash-senior-backend.json";
let testOutputRoot;

function testConfig(output) {
  return {
    paths: { output, baseResume: "data/resumes/base.json", aliases: "data/aliases.json", evidence: "data/evidence.json" },
    pipeline: { rewriteEnabled: false },
    render: { theme: "jsonresume-theme-stackoverflow" },
  };
}

test.before(async () => {
  testOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cv-tailor-observability-"));
});

test.after(async () => {
  await fs.rm(testOutputRoot, { recursive: true, force: true });
});

function failingRunner(_command, _args, options) {
  options.onStdout?.("token=do-not-log\\n");
  options.onStderr?.("Bearer do-not-log\\n");
  const error = new Error("analysis failed");
  error.code = "ANALYSIS_PROCESS_ERROR";
  return Promise.reject(error);
}

test("pipeline emits attributed, redacted child output and a normalized stage failure", async () => {
  await assert.rejects(
    runPipeline({ jobPath, skipRewrite: true, processRunner: failingRunner, configOverride: testConfig(testOutputRoot) }),
    /analysis failed/
  );

  // The run can be inspected from the progress payload in normal API usage; this
  // assertion uses the callback to validate the public structured-event contract.
  const events = [];
  await assert.rejects(
    runPipeline({
      jobPath,
      skipRewrite: true,
      processRunner: failingRunner,
      configOverride: testConfig(testOutputRoot),
      onProgress: (payload) => {
        if (payload.type === "pipeline_event") events.push(payload.event);
      },
    }),
    /analysis failed/
  );

  assert.equal(events.some((event) => event.event === "stage.started" && event.stage === "analyse"), true);
  assert.equal(events.some((event) => event.event === "process.output" && event.stage === "analyse" && event.stream === "stdout" && event.message.includes("[REDACTED]")), true);
  assert.equal(events.some((event) => event.event === "stage.failed" && event.stage === "analyse" && event.code === "ANALYSIS_PROCESS_ERROR"), true);
  assert.equal(events.some((event) => event.event === "pipeline.completed"), false);
});

test("successful pipeline stages report duration and artifact paths", async () => {
  const events = [];
  const runner = async (_command, args, options) => {
    options.onStdout?.("completed\\n");
    const script = args[0];
    if (script === "scripts/analyse.mjs") {
      await fs.mkdir(args[5], { recursive: true });
      const file = path.join(args[5], "flash-engenheira-de-software-senior-analysis.json");
      await fs.writeFile(file, JSON.stringify({ scores: {}, matches: { strong: [], related: [], missing: [] } }));
    }
    if (script === "scripts/tailor.mjs") {
      const outputDir = path.join(testOutputRoot, "flash");
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path.join(outputDir, "tailoring-plan.json"), JSON.stringify({ roles: [], globalCoverage: [], safety: {} }));
    }
    if (script === "scripts/final-check.mjs") {
      await fs.writeFile(args[3], JSON.stringify({ status: "pass", counts: { errors: 0, warnings: 0 } }));
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const result = await runPipeline({
    jobPath,
    skipRewrite: false,
    processRunner: runner,
    configOverride: testConfig(testOutputRoot),
    renderService: async () => ({ success: true, htmlPath: "resume.html", pdfPath: "resume.pdf", txtPath: "resume.txt", sanityCheckPassed: true }),
    onProgress: (payload) => {
      if (payload.type === "pipeline_event") events.push(payload.event);
    },
  });

  assert.equal(result.status, "success");
  const analyse = events.find((event) => event.event === "stage.completed" && event.stage === "analyse");
  assert.equal(typeof analyse.duration, "number");
  assert.equal(analyse.artifactPath, path.join(testOutputRoot, "flash", "analysis.json"));
  for (const stage of ["analyse", "tailor", "rewrite", "summary", "finalCheck", "render"]) {
    assert.equal(events.some((event) => event.event === "stage.completed" && event.stage === stage), true);
  }
  assert.equal(events.some((event) => event.event === "pipeline.completed"), true);
});
