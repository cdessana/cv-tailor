import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runJobParser } from "../../scripts/job-parser.mjs";
import { loadConfig } from "../../config/load-config.mjs";

const JOBS_DIR = path.resolve(process.cwd(), "data", "jobs");

function slug(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parses a raw job description using the official scripts/job-parser.mjs.
 */
export async function parseJobDescription({
  rawText,
  semanticProviderName = "none",
  customFilename,
}) {
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Job description text cannot be empty.");
  }

  await fs.mkdir(JOBS_DIR, { recursive: true });

  // Generate safe temp input path
  const tempInputPath = path.join(
    os.tmpdir(),
    `cv-tailor-job-input-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );

  await fs.writeFile(tempInputPath, rawText, "utf8");

  // Determine output target
  const outputBasename = customFilename
    ? slug(customFilename)
    : `parsed-job-${Date.now()}`;
  const targetOutputPath = path.join(JOBS_DIR, `${outputBasename}.json`);

  try {
    const config = loadConfig();
    const result = await runJobParser({
      input: tempInputPath,
      output: targetOutputPath,
      semanticProviderName,
      config,
    });

    // If company and title are extracted, rename to canonical company-title.json
    let finalOutputPath = targetOutputPath;
    const job = result.job;
    if (job?.company && job?.title) {
      const canonicalName = `${slug(job.company)}-${slug(job.title)}.json`;
      const canonicalPath = path.join(JOBS_DIR, canonicalName);
      if (canonicalPath !== targetOutputPath) {
        await fs.rename(targetOutputPath, canonicalPath);
        finalOutputPath = canonicalPath;
      }
    }

    return {
      success: true,
      job,
      outputPath: path.relative(process.cwd(), finalOutputPath),
      filename: path.basename(finalOutputPath),
      semanticProvider: result.semanticProvider,
    };
  } finally {
    // Clean up temporary input file
    await fs.rm(tempInputPath, { force: true }).catch(() => {});
  }
}

/**
 * List all parsed jobs in data/jobs/
 */
export async function listJobs() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  const entries = await fs.readdir(JOBS_DIR, { withFileTypes: true });
  const jobs = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".")) {
      try {
        const fullPath = path.join(JOBS_DIR, entry.name);
        const content = await fs.readFile(fullPath, "utf8");
        const parsed = JSON.parse(content);
        jobs.push({
          filename: entry.name,
          path: path.relative(process.cwd(), fullPath),
          title: parsed.title || "Untitled",
          company: parsed.company || "Unknown Company",
          type: parsed.type || null,
          remote: parsed.remote || null,
          requirementsCount: {
            required: (parsed.requirements?.required || []).length,
            preferred: (parsed.requirements?.preferred || []).length,
            competencies: (parsed.requirements?.competencies || []).length,
          },
          updatedAt: (await fs.stat(fullPath)).mtime.toISOString(),
        });
      } catch {
        // Ignore unparseable or partial files
      }
    }
  }

  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return jobs;
}

/**
 * Get a specific job by filename
 */
export async function getJobByFilename(filename) {
  const safeFilename = path.basename(filename);
  if (!safeFilename.endsWith(".json")) {
    throw new Error("Job file must be a .json file");
  }

  const fullPath = path.join(JOBS_DIR, safeFilename);
  const content = await fs.readFile(fullPath, "utf8");
  return {
    filename: safeFilename,
    path: path.relative(process.cwd(), fullPath),
    job: JSON.parse(content),
  };
}

/**
 * Save or update a parsed job with user edits
 */
export async function saveJob({ filename, job }) {
  if (!job || typeof job !== "object") {
    throw new Error("Invalid job data");
  }

  if (!job.company || typeof job.company !== "string" || !job.company.trim()) {
    throw new Error("Job must contain a valid company name");
  }

  if (!job.title || typeof job.title !== "string" || !job.title.trim()) {
    throw new Error("Job must contain a valid job title");
  }

  const safeFilename = filename
    ? path.basename(filename)
    : `${slug(job.company)}-${slug(job.title)}.json`;

  const fullPath = path.join(JOBS_DIR, safeFilename);

  // Atomic write
  const tempPath = `${fullPath}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(job, null, 2), "utf8");
  await fs.rename(tempPath, fullPath);

  return {
    success: true,
    filename: safeFilename,
    path: path.relative(process.cwd(), fullPath),
    job,
  };
}
