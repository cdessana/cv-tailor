import { Router } from "express";
import { runPipeline, getRunStatus } from "../services/pipeline-service.mjs";

const router = Router();

router.post("/run", async (req, res) => {
  const {
    jobPath,
    theme,
    skipRewrite,
    providerOverride,
    modelOverride,
  } = req.body || {};

  if (!jobPath) {
    return res.status(400).json({ error: "jobPath is required." });
  }

  // Check if client supports Server-Sent Events (SSE)
  const isSse = req.headers.accept && req.headers.accept.includes("text/event-stream");

  if (isSse) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await runPipeline({
        jobPath,
        theme,
        skipRewrite,
        providerOverride,
        modelOverride,
        onProgress: (payload) => {
          sendEvent("progress", payload);
        },
      });

      sendEvent("done", { success: true });
      res.end();
    } catch (err) {
      sendEvent("pipeline_error", { error: err.message });
      res.end();
    }
  } else {
    // Normal JSON response
    try {
      const runState = await runPipeline({
        jobPath,
        theme,
        skipRewrite,
        providerOverride,
        modelOverride,
      });
      res.json(runState);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
});

router.get("/status/:runId", (req, res) => {
  const status = getRunStatus(req.params.runId);
  if (!status) {
    return res.status(404).json({ error: "Run not found" });
  }
  res.json(status);
});

export default router;
