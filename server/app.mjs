import express from "express";
import path from "node:path";
import configRouter from "./routes/config.mjs";
import doctorRouter from "./routes/doctor.mjs";
import jobsRouter from "./routes/jobs.mjs";
import pipelineRouter from "./routes/pipeline.mjs";
import renderRouter from "./routes/render.mjs";
import evidenceRouter from "./routes/evidence.mjs";
import artifactsRouter from "./routes/artifacts.mjs";
import linkedInImportRouter from "./routes/linkedin-import.mjs";

export function createApp() {
  const app = express();
  const publicDir = path.resolve(process.cwd(), "public");

  // Middlewares
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // API Routes
  app.use("/api/config", configRouter);
  app.use("/api/doctor", doctorRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/pipeline", pipelineRouter);
  app.use("/api/render", renderRouter);
  app.use("/api/evidence", evidenceRouter);
  app.use("/api/artifacts", artifactsRouter);
  app.use("/api/linkedin-import", linkedInImportRouter);

  // Serve static assets
  app.use(express.static(publicDir));

  // SPA Fallback
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Endpoint not found" });
    }
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });

  // Central error handler
  app.use((err, req, res, next) => {
    console.error(`[Server Error] ${req.method} ${req.url}:`, err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
      details: err.details || null,
    });
  });

  return app;
}
