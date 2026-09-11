import fs from "node:fs/promises";
import path from "node:path";
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

/**
 * Execute the full pipeline or step-by-step with structured events.
 */
export async function runPipeline({
  jobPath,
  theme,
  skipRewrite: overrideSkipRewrite,
  providerOverride,
  modelOverride,
  onProgress = () => {},
}) {
  const config = loadConfig();

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

  const runId = `${companySlug}-${Date.now()}`;
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
    error: null,
  };

  runHistoryCache.set(runId, runState);

  function log(message) {
    const entry = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
    runState.logs.push(entry);
    onProgress({ type: "log", message: entry, runState });
  }

  function updateStage(stageKey, updates) {
    runState.stages[stageKey] = { ...runState.stages[stageKey], ...updates };
    onProgress({ type: "stage_update", stage: stageKey, data: runState.stages[stageKey], runState });
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
    log(`Starting CV Tailor pipeline for ${job.company} — ${job.title}`);
    log(`Target output: ${outputDir}/`);
    log(`LLM rewrite enabled: ${!skipRewrite}`);

    // -------------------------------------------------------------
    // STAGE 1: ANALYSE
    // -------------------------------------------------------------
    updateStage("analyse", { status: "running", startedAt: Date.now() });
    log("▶ Running Stage 1: Analyse (matching requirements against evidence)");
    const t0 = Date.now();

    const generatedAnalysisPath = path.join(outputRoot, `${companySlug}-${titleSlug}-analysis.json`);
    const analysisPath = path.join(outputDir, "analysis.json");

    await spawnSafe("node", [
      "scripts/analyse.mjs",
      resumePath,
      resolvedJobPath,
      aliasesPath,
      evidencePath,
      outputRoot,
    ], { cwd: PROJECT_ROOT, env: childEnv });

    if (!(await fileExists(generatedAnalysisPath))) {
      throw new Error(`Expected analysis output file was not found: ${generatedAnalysisPath}`);
    }

    await fs.copyFile(generatedAnalysisPath, analysisPath);
    await fs.unlink(generatedAnalysisPath).catch(() => {});

    const analysisData = JSON.parse(await fs.readFile(analysisPath, "utf8"));
    runState.artifacts.analysis = analysisData;

    updateStage("analyse", {
      status: "success",
      duration: ((Date.now() - t0) / 1000).toFixed(2),
      artifact: "analysis.json",
      data: {
        scores: analysisData.scores,
        strongCount: (analysisData.matches?.strong || []).length,
        relatedCount: (analysisData.matches?.related || []).length,
        missingCount: (analysisData.matches?.missing || []).length,
      },
    });
    log(`✓ Analyse complete in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

    // -------------------------------------------------------------
    // STAGE 2: TAILOR
    // -------------------------------------------------------------
    updateStage("tailor", { status: "running", startedAt: Date.now() });
    log("▶ Running Stage 2: Tailor (experience & bullet selection)");
    const t1 = Date.now();

    const tailoringPlanPath = path.join(outputDir, "tailoring-plan.json");

    await spawnSafe("node", [
      "scripts/tailor.mjs",
      resumePath,
      analysisPath,
      aliasesPath,
      evidencePath,
    ], { cwd: PROJECT_ROOT, env: childEnv });

    if (!(await fileExists(tailoringPlanPath))) {
      throw new Error(`Expected tailoring plan not found: ${tailoringPlanPath}`);
    }

    const tailoringPlan = JSON.parse(await fs.readFile(tailoringPlanPath, "utf8"));
    runState.artifacts.tailoringPlan = tailoringPlan;

    const tailoringReportPath = path.join(outputDir, "tailoring-report.json");
    if (await fileExists(tailoringReportPath)) {
      runState.artifacts.tailoringReport = JSON.parse(await fs.readFile(tailoringReportPath, "utf8"));
    }

    updateStage("tailor", {
      status: "success",
      duration: ((Date.now() - t1) / 1000).toFixed(2),
      artifact: "tailoring-plan.json",
      data: {
        totalExperiences: tailoringPlan.roles?.length || 0,
      },
    });
    log(`✓ Tailor complete in ${((Date.now() - t1) / 1000).toFixed(2)}s`);

    // -------------------------------------------------------------
    // STAGE 3: REWRITE (Optional)
    // -------------------------------------------------------------
    const resumeRewrittenPath = path.join(outputDir, "resume-rewritten.json");
    const rewriteReportPath = path.join(outputDir, "rewrite-report.json");

    if (!skipRewrite) {
      updateStage("rewrite", { status: "running", startedAt: Date.now() });
      log("▶ Running Stage 3: LLM Rewrite (focussing bullets within factual boundary)");
      const t2 = Date.now();

      await spawnSafe("node", [
        "scripts/rewrite.mjs",
        resumePath,
        tailoringPlanPath,
        resumeRewrittenPath,
        rewriteReportPath,
      ], { cwd: PROJECT_ROOT, env: childEnv });

      if (await fileExists(rewriteReportPath)) {
        runState.artifacts.rewriteReport = JSON.parse(await fs.readFile(rewriteReportPath, "utf8"));
      }

      updateStage("rewrite", {
        status: "success",
        duration: ((Date.now() - t2) / 1000).toFixed(2),
        artifact: "resume-rewritten.json",
      });
      log(`✓ Rewrite complete in ${((Date.now() - t2) / 1000).toFixed(2)}s`);
    } else {
      log("○ Skipping LLM rewrite step (rewriteEnabled is false or --skip-rewrite passed)");
      updateStage("rewrite", { status: "skipped", duration: "0.00" });
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
      updateStage("summary", { status: "running", startedAt: Date.now() });
      log("▶ Running Stage 4: Summary Generation");
      const t3 = Date.now();

      await spawnSafe("node", [
        "scripts/summary.mjs",
        summaryInputPath,
        tailoringPlanPath,
        resumeFinalPath,
        summaryReportPath,
      ], { cwd: PROJECT_ROOT, env: childEnv });

      if (await fileExists(summaryReportPath)) {
        runState.artifacts.summaryReport = JSON.parse(await fs.readFile(summaryReportPath, "utf8"));
      }

      updateStage("summary", {
        status: "success",
        duration: ((Date.now() - t3) / 1000).toFixed(2),
        artifact: "resume-final.json",
      });
      log(`✓ Summary complete in ${((Date.now() - t3) / 1000).toFixed(2)}s`);
    } else {
      log("○ Skipping LLM summary step (rewrite skipped)");
      updateStage("summary", { status: "skipped", duration: "0.00" });
    }

    // -------------------------------------------------------------
    // STAGE 5: FINAL CHECK
    // -------------------------------------------------------------
    updateStage("finalCheck", { status: "running", startedAt: Date.now() });
    log("▶ Running Stage 5: Final Check (strict factual validation)");
    const t4 = Date.now();

    const finalCheckInputPath = skipRewrite
      ? path.join(outputDir, "resume.json")
      : resumeFinalPath;
    const finalCheckPath = path.join(outputDir, "final-check.json");

    // final-check exits with code 1 if errors exist, but still writes final-check.json
    try {
      await spawnSafe("node", [
        "scripts/final-check.mjs",
        finalCheckInputPath,
        tailoringPlanPath,
        finalCheckPath,
      ], { cwd: PROJECT_ROOT, env: childEnv });
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

    updateStage("finalCheck", {
      status: checkStatus,
      duration: ((Date.now() - t4) / 1000).toFixed(2),
      artifact: "final-check.json",
      data: {
        status: finalCheck.status,
        counts: finalCheck.counts,
        errors: finalCheck.errors || [],
        warnings: finalCheck.warnings || [],
        info: finalCheck.info || [],
      },
    });
    log(`✓ Final Check: ${finalCheck.status.toUpperCase()} (${finalCheck.counts?.errors || 0} errors, ${finalCheck.counts?.warnings || 0} warnings)`);

    // -------------------------------------------------------------
    // STAGE 6: RENDER
    // -------------------------------------------------------------
    updateStage("render", { status: "running", startedAt: Date.now() });
    log(`▶ Running Stage 6: Render (theme: ${effectiveTheme})`);
    const t5 = Date.now();

    const resumeToRender = skipRewrite
      ? path.join(outputDir, "resume.json")
      : resumeFinalPath;

    // Ensure resume-final.json exists for uniform preview and diffing
    if (skipRewrite && (await fileExists(resumeToRender))) {
      await fs.copyFile(resumeToRender, resumeFinalPath);
    }

    try {
      const renderResult = await renderResume({
        resumePath: resumeToRender,
        theme: effectiveTheme,
        outputDir,
      });

      runState.artifacts.html = renderResult.htmlPath;
      runState.artifacts.pdf = renderResult.pdfPath;
      runState.artifacts.txt = renderResult.txtPath;

      updateStage("render", {
        status: renderResult.success ? "success" : "warning",
        duration: ((Date.now() - t5) / 1000).toFixed(2),
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
      updateStage("render", {
        status: "warning",
        duration: ((Date.now() - t5) / 1000).toFixed(2),
        error: renderError.message,
      });
    }

    // Done
    runState.status = checkStatus === "failed" ? "failed" : "success";
    runState.completedAt = new Date().toISOString();
    log(`Pipeline completed with status: ${runState.status.toUpperCase()}`);

    onProgress({ type: "complete", runState });
    return runState;
  } catch (error) {
    runState.status = "failed";
    runState.error = error.message;
    runState.completedAt = new Date().toISOString();
    log(`Pipeline failed: ${error.message}`);
    onProgress({ type: "error", error: error.message, runState });
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
