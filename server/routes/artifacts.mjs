import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import {
  listRuns,
  resolveSafeArtifactPath,
  readArtifact,
  artifactExists,
} from "../services/artifact-service.mjs";

const router = Router();

// List historical runs
router.get("/runs", async (req, res, next) => {
  try {
    const runs = await listRuns();
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

// HTML preview inline in iframe
router.get("/:companySlug/preview", async (req, res) => {
  try {
    const filePath = resolveSafeArtifactPath(req.params.companySlug, "resume.html");
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) {
      return res.status(404).send("<h3>Resume HTML preview not found. Please run the render step.</h3>");
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const content = await fs.readFile(filePath, "utf8");
    res.send(content);
  } catch (err) {
    res.status(400).send(`Error: ${err.message}`);
  }
});

// Download / View specific artifact
router.get("/:companySlug/:filename", async (req, res) => {
  try {
    const { companySlug, filename } = req.params;
    const filePath = resolveSafeArtifactPath(companySlug, filename);

    const exists = await artifactExists(companySlug, filename);
    if (!exists) {
      return res.status(404).json({ error: `Artifact ${filename} not found for ${companySlug}` });
    }

    const ext = path.extname(filename).toLowerCase();
    if (ext === ".pdf") {
      res.setHeader("Content-Type", "application/pdf");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${companySlug}-${filename}"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="${companySlug}-${filename}"`);
      }
      return res.sendFile(filePath);
    } else if (ext === ".html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${companySlug}-${filename}"`);
      }
      return res.sendFile(filePath);
    } else if (ext === ".txt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${companySlug}-${filename}"`);
      }
      return res.sendFile(filePath);
    } else if (ext === ".json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${companySlug}-${filename}"`);
      }
      return res.sendFile(filePath);
    }

    res.sendFile(filePath);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
