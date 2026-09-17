import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSafe } from "../process/spawn-safe.mjs";
import { loadConfig } from "../../config/load-config.mjs";
import { renderResume } from "./render-service.mjs";

const PROJECT_ROOT = path.resolve(process.cwd());

function slug(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// In-memory active runs registry & locks
const activeRunLocks = new Set();
const runHistoryCache = new Map();
const MAX_RUN_LOG_ENTRIES = 2_000;
const MAX_RUN_EVENTS = 2_000;

function sanitizeLogValue(value) {
  return String(value ?? "")
    .replace(/(api[_-]?key|token|secret|password)\s*([=:])\s*[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:key|api[_-]?key|token)=)[^&\s]+/gi, "$1[REDACTED]");
}

function errorDetails(error, stage) {
  const cause = error?.cause;
  return {
    code: error?.code ?? cause?.code ?? "PIPELINE_STAGE_ERROR",
    message: sanitizeLogValue(error?.message ?? "Unexpected pipeline failure."),
    stage,
    ...(cause?.message ? { cause: sanitizeLogValue(cause.message) } : {}),
  };
}

function durationSeconds(startedAt) {
  return Number(((Date.now() - startedAt) / 1000).toFixed(2));
}

/**
 * Execute the full pipeline or step-by-step with structured events.
 */
export async function runPipeline({
  jobPath,
  theme,
  skipRewrite: overrideSkipRewrite,
  analysisOnly = false,
  providerOverride,
  modelOverride,
  onProgress = () => {},
  logger = console,
  processRunner = spawnSafe,
  renderService = renderResume,
  configOverride,
}) {
  const config = configOverride ?? loadConfig();

  const resolvedJobPath = path.resolve(PROJECT_ROOT, jobPath);
  if (!resolvedJobPath.startsWith(PROJECT_ROOT)) {
    throw new Error("Access denied: jobPath outside workspace.");
  }

  const rawJob = await fs.readFile(resolvedJobPath, "utf8");
  const job = JSON.parse(rawJob);

  const companySlug = slug(job.company);
  const titleSlug = slug(job.title);

  if (!companySlug) throw new Error("Job JSON must contain a valid company name.");
  if (!titleSlug) throw new Error("Job JSON must contain a valid job title.");

  // Concurrency serialization per company
  if (activeRunLocks.has(companySlug)) {
    throw new Error(`A pipeline run is already in progress for company "${job.company}". Please wait for it to complete.`);
  }

  activeRunLocks.add(companySlug);

  const runId = `${companySlug}-${randomUUID()}`;
  const outputRoot = config.paths.output;
  const outputDir = path.join(outputRoot, companySlug);
  await fs.mkdir(outputDir, { recursive: true });

  const resumePath = config.paths.baseResume;
  const aliasesPath = config.paths.aliases;
  const evidencePath = config.paths.evidence;

  const skipRewrite =
    typeof overrideSkipRewrite === "boolean"
      ? overrideSkipRewrite
      : !config.pipeline.rewriteEnabled;

  const effectiveTheme = theme || config.render.theme;

  const runState = {
    runId,
    company: job.company,
    title: job.title,
    companySlug,
    titleSlug,
    outputDir,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    skipRewrite,
    analysisOnly,
    stages: {
      analyse: { name: "Analyse", status: "pending", duration: null, artifact: null },
      tailor: { name: "Tailor", status: "pending", duration: null, artifact: null },
      rewrite: { name: "Rewrite", status: skipRewrite ? "skipped" : "pending", duration: null, artifact: null },
      summary: { name: "Summary", status: skipRewrite ? "skipped" : "pending", duration: null, artifact: null },
      finalCheck: { name: "Final Check", status: "pending", duration: null, artifact: null },
      render: { name: "Render", status: "pending", duration: null, artifact: null },
    },
    artifacts: {},
    logs: [],
    events: [],
    error: null,
  };

  runHistoryCache.set(runId, runState);

  function log(message) {
    const entry = `[${new Date().toISOString().slice(11, 19)}] ${sanitizeLogValue(message)}`;
    if (runState.logs.length >= MAX_RUN_LOG_ENTRIES) return;
    runState.logs.push(entry);
    logger.log?.(entry);
    onProgress({ type: "log", message: entry, runState });
  }

  function emitEvent(event, details = {}) {
    if (runState.events.length >= MAX_RUN_EVENTS) return null;
    const entry = {
      version: 1,
      runId,
      event,
      at: new Date().toISOString(),
      ...details,
    };
    runState.events.push(entry);
    onProgress({ type: "pipeline_event", event: entry, runState });
    return entry;
  }

  function updateStage(stageKey, updates) {
    runState.stages[stageKey] = { ...runState.stages[stageKey], ...updates };
    onProgress({ type: "stage_update", stage: stageKey, data: runState.stages[stageKey], runState });
  }

  function startStage(stageKey) {
    const startedAt = Date.now();
    updateStage(stageKey, { status: "running", startedAt });
    emitEvent("stage.started", { stage: stageKey });
    return startedAt;
  }

  function finishStage(stageKey, startedAt, updates = {}) {
    const duration = durationSeconds(startedAt);
    updateStage(stageKey, { ...updates, duration });
    emitEvent(runState.stages[stageKey].status === "failed" ? "stage.failed" : "stage.completed", {
      stage: stageKey,
      status: runState.stages[stageKey].status,
      duration,
      ...(runState.stages[stageKey].artifact
        ? {
            artifact: runState.stages[stageKey].artifact,
            artifactPath: path.join(outputDir, runState.stages[stageKey].artifact),
          }
        : {}),
    });
  }

  function recordChildOutput(stage, stream, line) {
    const message = `[${stage}][${stream}] ${line}`;
    log(message);
    emitEvent("process.output", { stage, stream, message: sanitizeLogValue(line) });
  }

  async function runChildStage(stage, args) {
    const buffers = { stdout: "", stderr: "" };
    const flush = (stream, chunk) => {
      buffers[stream] += chunk;
      const lines = buffers[stream].split("\n");
      buffers[stream] = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) recordChildOutput(stage, stream, line);
      }
    };
    try {
      return await processRunner("node", args, {
        cwd: PROJECT_ROOT,
        env: childEnv,
        onStdout: (chunk) => flush("stdout", chunk),
        onStderr: (chunk) => flush("stderr", chunk),
      });
    } finally {
      for (const stream of ["stdout", "stderr"]) {
        if (buffers[stream].trim()) recordChildOutput(stage, stream, buffers[stream]);
      }
    }
  }

  // Set environment overrides for child process if requested
  const childEnv = { ...process.env };
  if (providerOverride) {
    childEnv.LLM_PROVIDER = providerOverride;
  }
  if (modelOverride) {
    if (providerOverride === "ollama") childEnv.OLLAMA_MODEL = modelOverride;
  }

  try {
    emitEvent("pipeline.started", {
      job: { company: job.company, title: job.title },
      outputDir,
      rewriteEnabled: !skipRewrite,
      analysisOnly,
    });
    log(`Starting CV Tailor pipeline for ${job.company} — ${job.title}`);
    log(`Target output: ${outputDir}/`);
    log(`LLM rewrite enabled: ${!skipRewrite}`);
    log(`Analysis-only mode: ${analysisOnly}`);

    // -------------------------------------------------------------
    // STAGE 1: ANALYSE
    // -------------------------------------------------------------
    const t0 = startStage("analyse");
    log("▶ Running Stage 1: Analyse (matching requirements against evidence)");

    const generatedAnalysisPath = path.join(outputRoot, `${companySlug}-${titleSlug}-analysis.json`);
    const analysisPath = path.join(outputDir, "analysis.json");

    await runChildStage("analyse", [
      "scripts/analyse.mjs",
      resumePath,
      resolvedJobPath,
      aliasesPath,
      evidencePath,
      outputRoot,
    ]);

    if (!(await fileExists(generatedAnalysisPath))) {
      throw new Error(`Expected analysis output file was not found: ${generatedAnalysisPath}`);
    }

    await fs.copyFile(generatedAnalysisPath, analysisPath);
    await fs.unlink(generatedAnalysisPath).catch(() => {});

    const analysisData = JSON.parse(await fs.readFile(analysisPath, "utf8"));
    runState.artifacts.analysis = analysisData;

    finishStage("analyse", t0, {
      status: "success",
      artifact: "analysis.json",
      data: {
        scores: analysisData.scores,
        strongCount: (analysisData.matches?.strong || []).length,
        relatedCount: (analysisData.matches?.related || []).length,
        missingCount: (analysisData.matches?.missing || []).length,
      },
    });
    log(`✓ Analyse complete in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

    if (analysisOnly) {
      for (const stage of ["tailor", "rewrite", "summary", "finalCheck", "render"]) {
        updateStage(stage, { status: "skipped", duration: 0 });
        emitEvent("stage.completed", { stage, status: "skipped", duration: 0 });
      }
      runState.status = "success";
      runState.completedAt = new Date().toISOString();
      emitEvent("pipeline.completed", { status: runState.status, artifacts: Object.keys(runState.artifacts) });
      log("Analysis-only pipeline completed successfully.");
      onProgress({ type: "complete", runState });
      return runState;
    }

    // -------------------------------------------------------------
    // STAGE 2: TAILOR
    // -------------------------------------------------------------
    const t1 = startStage("tailor");
    log("▶ Running Stage 2: Tailor (experience & bullet selection)");

    const tailoringPlanPath = path.join(outputDir, "tailoring-plan.json");

    await runChildStage("tailor", [
      "scripts/tailor.mjs",
      resumePath,
      analysisPath,
      aliasesPath,
      evidencePath,
    ]);

    if (!(await fileExists(tailoringPlanPath))) {
      throw new Error(`Expected tailoring plan not found: ${tailoringPlanPath}`);
    }

    const tailoringPlan = JSON.parse(await fs.readFile(tailoringPlanPath, "utf8"));
    runState.artifacts.tailoringPlan = tailoringPlan;

    const tailoringReportPath = path.join(outputDir, "tailoring-report.json");
    if (await fileExists(tailoringReportPath)) {
      runState.artifacts.tailoringReport = JSON.parse(await fs.readFile(tailoringReportPath, "utf8"));
    }

    // High-signal summary logging
    const totalExperiences = tailoringPlan.roles?.length || 0;
    const totalBullets = tailoringPlan.roles?.reduce((sum, role) => sum + (role.selected?.length || 0), 0) || 0;
    const coveredTerms = tailoringPlan.globalCoverage?.filter((c) => c.covered).length || 0;
    const totalTerms = tailoringPlan.globalCoverage?.length || 0;
    const unsupportedCount = tailoringPlan.safety?.unsupportedTerms?.length || 0;

    log("Tailoring Summary:");
    log(`- Selected ${totalExperiences} roles/experiences containing ${totalBullets} total items/bullets.`);
    log(`- Global requirement coverage: ${coveredTerms}/${totalTerms} terms matched.`);
    if (unsupportedCount > 0) {
      log(`- Safety guardrails: ${unsupportedCount} unsupported terms will be avoided.`);
    }

    finishStage("tailor", t1, {
      status: "success",
      artifact: "tailoring-plan.json",
      data: {
        totalExperiences,
      },
    });
    log(`✓ Tailor complete in ${((Date.now() - t1) / 1000).toFixed(2)}s`);

    // -------------------------------------------------------------
    // STAGE 3: REWRITE (Optional)
    // -------------------------------------------------------------
    const resumeRewrittenPath = path.join(outputDir, "resume-rewritten.json");
    const rewriteReportPath = path.join(outputDir, "rewrite-report.json");

    if (!skipRewrite) {
      const t2 = startStage("rewrite");
      log("▶ Running Stage 3: LLM Rewrite (focussing bullets within factual boundary)");

      await runChildStage("rewrite", [
        "scripts/rewrite.mjs",
        resumePath,
        tailoringPlanPath,
        resumeRewrittenPath,
        rewriteReportPath,
      ]);

      if (await fileExists(rewriteReportPath)) {
        runState.artifacts.rewriteReport = JSON.parse(await fs.readFile(rewriteReportPath, "utf8"));
      }

      finishStage("rewrite", t2, {
        status: "success",
        artifact: "resume-rewritten.json",
      });
      log(`✓ Rewrite complete in ${((Date.now() - t2) / 1000).toFixed(2)}s`);
    } else {
      log("○ Skipping LLM rewrite step (rewriteEnabled is false or --skip-rewrite passed)");
      updateStage("rewrite", { status: "skipped", duration: "0.00" });
      emitEvent("stage.completed", { stage: "rewrite", status: "skipped", duration: 0 });
    }

    // -------------------------------------------------------------
    // STAGE 4: SUMMARY (Optional)
    // -------------------------------------------------------------
    const summaryInputPath = skipRewrite
      ? path.join(outputDir, "resume.json")
      : resumeRewrittenPath;
    const resumeFinalPath = path.join(outputDir, "resume-final.json");
    const summaryReportPath = path.join(outputDir, "summary-report.json");

    if (!skipRewrite) {
      const t3 = startStage("summary");
      log("▶ Running Stage 4: Summary Generation");

      await runChildStage("summary", [
        "scripts/summary.mjs",
        summaryInputPath,
        tailoringPlanPath,
        resumeFinalPath,
        summaryReportPath,
      ]);

      if (await fileExists(summaryReportPath)) {
        runState.artifacts.summaryReport = JSON.parse(await fs.readFile(summaryReportPath, "utf8"));
      }

      finishStage("summary", t3, {
        status: "success",
        artifact: "resume-final.json",
      });
      log(`✓ Summary complete in ${((Date.now() - t3) / 1000).toFixed(2)}s`);
    } else {
      log("○ Skipping LLM summary step (rewrite skipped)");
      updateStage("summary", { status: "skipped", duration: "0.00" });
      emitEvent("stage.completed", { stage: "summary", status: "skipped", duration: 0 });
    }

    // -------------------------------------------------------------
    // STAGE 5: FINAL CHECK
    // -------------------------------------------------------------
    const t4 = startStage("finalCheck");
    log("▶ Running Stage 5: Final Check (strict factual validation)");

    const finalCheckInputPath = skipRewrite
      ? path.join(outputDir, "resume.json")
      : resumeFinalPath;
    const finalCheckPath = path.join(outputDir, "final-check.json");

    // final-check exits with code 1 if errors exist, but still writes final-check.json
    try {
      await runChildStage("finalCheck", [
        "scripts/final-check.mjs",
        finalCheckInputPath,
        tailoringPlanPath,
        finalCheckPath,
      ]);
    } catch {
      // Handled below by reading final-check.json
    }

    if (!(await fileExists(finalCheckPath))) {
      throw new Error(`Expected final-check report not found: ${finalCheckPath}`);
    }

    const finalCheck = JSON.parse(await fs.readFile(finalCheckPath, "utf8"));
    runState.artifacts.finalCheck = finalCheck;

    const checkStatus =
      (finalCheck.counts?.errors > 0 || finalCheck.status === "fail")
        ? "failed"
        : (finalCheck.counts?.warnings > 0 || finalCheck.status === "review" || finalCheck.status === "warning")
        ? "warning"
        : "success";

    finishStage("finalCheck", t4, {
      status: checkStatus,
      artifact: "final-check.json",
      data: {
        status: finalCheck.status,
        counts: finalCheck.counts,
        errors: finalCheck.errors || [],
        warnings: finalCheck.warnings || [],
        info: finalCheck.info || [],
      },
      ...(checkStatus === "failed"
        ? {
            error: {
              code: "FINAL_CHECK_FAILED",
              message: "Final factual validation reported errors.",
              stage: "finalCheck",
            },
          }
        : {}),
    });
    log(`✓ Final Check: ${finalCheck.status.toUpperCase()} (${finalCheck.counts?.errors || 0} errors, ${finalCheck.counts?.warnings || 0} warnings)`);

    // -------------------------------------------------------------
    // STAGE 6: RENDER
    // -------------------------------------------------------------
    const t5 = startStage("render");
    log(`▶ Running Stage 6: Render (theme: ${effectiveTheme})`);

    const resumeToRender = skipRewrite
      ? path.join(outputDir, "resume.json")
      : resumeFinalPath;

    // Ensure resume-final.json exists for uniform preview and diffing
    if (skipRewrite && (await fileExists(resumeToRender))) {
      await fs.copyFile(resumeToRender, resumeFinalPath);
    }

    try {
      const renderResult = await renderService({
        resumePath: resumeToRender,
        theme: effectiveTheme,
        outputDir,
      });

      runState.artifacts.html = renderResult.htmlPath;
      runState.artifacts.pdf = renderResult.pdfPath;
      runState.artifacts.txt = renderResult.txtPath;

      finishStage("render", t5, {
        status: renderResult.success ? "success" : "warning",
        artifact: "resume.html",
        data: {
          htmlPath: renderResult.htmlPath,
          pdfPath: renderResult.pdfPath,
          txtPath: renderResult.txtPath,
          sanityCheckPassed: renderResult.sanityCheckPassed,
        },
      });
      log(`✓ Render completed in ${((Date.now() - t5) / 1000).toFixed(2)}s`);
    } catch (renderError) {
      log(`! Render encountered an issue: ${renderError.message}`);
      finishStage("render", t5, {
        status: "failed",
        error: errorDetails(renderError, "render"),
      });
    }

    // Done
    runState.status = [checkStatus, runState.stages.render.status].includes("failed")
      ? "failed"
      : "success";
    runState.completedAt = new Date().toISOString();
    if (runState.status === "failed") {
      const failure = runState.stages.finalCheck.status === "failed"
        ? runState.stages.finalCheck.error
        : runState.stages.render.error;
      emitEvent("pipeline.failed", failure);
    } else {
      emitEvent("pipeline.completed", { status: runState.status, artifacts: Object.keys(runState.artifacts) });
    }
    log(`Pipeline completed with status: ${runState.status.toUpperCase()}`);

    onProgress({ type: "complete", runState });
    return runState;
  } catch (error) {
    const failedStage = Object.entries(runState.stages).find(([, value]) => value.status === "running")?.[0] ?? "pipeline";
    const details = errorDetails(error, failedStage);
    runState.status = "failed";
    runState.error = details;
    runState.completedAt = new Date().toISOString();
    if (failedStage !== "pipeline") {
      updateStage(failedStage, { status: "failed", error: details });
    }
    emitEvent("stage.failed", details);
    emitEvent("pipeline.failed", details);
    log(`Pipeline failed at ${failedStage}: ${details.message}`);
    onProgress({ type: "error", error: details, runState });
    throw error;
  } finally {
    activeRunLocks.delete(companySlug);
  }
}

/**
 * Get status of an active or recent pipeline run
 */
export function getRunStatus(runId) {
  return runHistoryCache.get(runId) || null;
}
