/**
 * @file constants.js
 * @description Centralized UI selectors and pipeline stage definitions.
 */

export const UI_SELECTORS = {
  PARSER_ALERT: "#parser-alert",
  STAGE_JOB_INPUT: "#stage-job-input",
  STAGE_JOB_REVIEW: "#stage-job-review",
  STAGE_JOB_ANALYSIS: "#stage-job-analysis",
  STAGE_PIPELINE_EXEC: "#stage-pipeline-exec",
  STAGE_PREVIEW_ARTIFACTS: "#stage-preview-artifacts",
  SELECT_EXISTING_JOB: "#select-existing-job",
  RAW_JOB_JSON_TEXTAREA: "#raw-job-json-textarea",
  INPUT_TARGET_COMPANY: "#input-target-company",
  BTN_RESET_WORKSPACE: "#btn-reset-workspace",
};

export const PIPELINE_STAGES = ["analyse", "tailor", "rewrite", "summary", "finalCheck", "render"];

export const STEP_STAGES = {
  1: "stage-job-input",
  2: "stage-job-review",
  3: "stage-job-analysis",
  4: "stage-pipeline-exec",
  5: "stage-preview-artifacts",
};
