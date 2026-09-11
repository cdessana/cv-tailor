import { Router } from "express";
import {
  parseJobDescription,
  listJobs,
  getJobByFilename,
  saveJob,
} from "../services/job-service.mjs";

const router = Router();

// Parse raw job description text
router.post("/parse", async (req, res) => {
  const { rawText, semanticProviderName, customFilename } = req.body || {};

  if (!rawText || !rawText.trim()) {
    return res.status(400).json({ error: "Job description text is required." });
  }

  try {
    const result = await parseJobDescription({
      rawText,
      semanticProviderName: semanticProviderName || "none",
      customFilename,
    });
    res.json(result);
  } catch (err) {
    const isSemanticRequired =
      err.message?.includes("SEMANTIC_PROVIDER_REQUIRED") ||
      err.code === "SEMANTIC_PROVIDER_REQUIRED";

    res.status(isSemanticRequired ? 422 : 500).json({
      error: err.message,
      code: isSemanticRequired ? "SEMANTIC_PROVIDER_REQUIRED" : "PARSE_ERROR",
      needsSemanticProvider: isSemanticRequired,
    });
  }
});

// List all parsed jobs
router.get("/", async (req, res, next) => {
  try {
    const jobs = await listJobs();
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// Get job by filename
router.get("/:filename", async (req, res) => {
  try {
    const job = await getJobByFilename(req.params.filename);
    res.json(job);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Update or save edited job
router.put("/:filename", async (req, res) => {
  try {
    const result = await saveJob({
      filename: req.params.filename,
      job: req.body.job || req.body,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
