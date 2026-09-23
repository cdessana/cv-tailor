import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const app = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

test("a new parse clears the prior workspace before its request and always releases parse state", () => {
  const handler = between('$("#btn-parse-job")?.addEventListener', '    // Reset workspace');
  assert.ok(handler.indexOf("resetWorkspaceState") < handler.indexOf('fetch("/api/jobs/parse"'));
  assert.ok(handler.indexOf("setJobParseInFlight(true)") < handler.indexOf('fetch("/api/jobs/parse"'));
  assert.match(handler, /finally \{[\s\S]*?setJobParseInFlight\(false\)/u);
  assert.match(handler, /signal: parseAbortController\.signal/u);
  assert.ok(handler.indexOf("loadJobIntoReview(data.job, data.outputPath") > handler.indexOf("if (!res.ok)"));
});

test("workspace reset clears live output and aborts active parse and pipeline requests", () => {
  const reset = between("function resetWorkspaceState", "  // -------------------------------------------------------------\n  // Stage 2");
  for (const token of ["jobParseAbortController.abort()", "pipelineAbortController.abort()", "hideParserAlert()", "clearWorkspaceOutputs()", "state.currentJob = null", "state.currentJobPath = null", "state.currentAnalysis = null", "state.currentRun = null", "updateStepIndicators(1)"]) assert.ok(reset.includes(token), `missing ${token}`);
  const outputs = between("function clearWorkspaceOutputs", "  function resetWorkspaceState");
  for (const token of ["#stage-job-review", "#stage-job-analysis", "#stage-pipeline-exec", "#stage-preview-artifacts", "#pipeline-log-terminal", "#final-check-audit-card", "#resume-preview-frame", "#diff-base-content"]) assert.ok(outputs.includes(token), `missing ${token}`);
});

test("history loading is disabled for the full duration of a parse", () => {
  const inFlight = between("function setJobParseInFlight", "  function clearWorkspaceOutputs");
  assert.match(inFlight, /\.btn-load-run-to-workspace/u);
  assert.match(inFlight, /button\.disabled = isRunning/u);
  const history = between("async function loadHistoryRuns", "  // -------------------------------------------------------------\n  // Settings");
  assert.ok(history.includes('state.jobParseInFlight ? "disabled aria-disabled'));
  assert.ok(history.includes("if (state.jobParseInFlight) return"));
});

test("local provider copy and successful parse behavior retain non-fatal parser warnings", () => {
  assert.match(app, /ambiguous content may be left for review instead of being inferred/u);
  assert.match(html, /ambiguous content may be left for review instead of being inferred/u);
  assert.doesNotMatch(app, /Parser fails safely if unresolved ambiguous items require semantic inference/u);
  assert.doesNotMatch(html, /Parser fails safely if unresolved items require semantic inference/u);
  const handler = between('$("#btn-parse-job")?.addEventListener', '    // Reset workspace');
  assert.match(handler, /loadJobIntoReview\(data\.job, data\.outputPath, data\.parser, data\.warnings, data\.diagnostics\)/u);
});

test("job review renders backend parser diagnostics without assigning unresolved source semantics", () => {
  assert.match(app, /loadJobIntoReview\(data\.job, data\.outputPath, data\.parser, data\.warnings, data\.diagnostics\)/u);
  const diagnostics = between("function renderParserDiagnostics", "  function renderRequirementsColumns");
  for (const token of ["parser.mode", "diagnostics.unresolved", "item.sourceSection", "item.signal", "item.reason", "item.sourceText"]) assert.ok(diagnostics.includes(token), `missing ${token}`);
  assert.doesNotMatch(diagnostics, /classification\s*=|classification:/u);
  const reset = between("function resetWorkspaceState", "  // -------------------------------------------------------------\n  // Stage 2");
  assert.ok(reset.includes("state.currentParser = null"));
});
