import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = path.resolve(process.cwd());
const OUTPUT_ROOT = path.resolve(PROJECT_ROOT, "output");

/**
 * Validate and safely resolve an artifact file inside the output directory.
 * Prevents directory traversal attacks.
 */
export function resolveSafeArtifactPath(companySlug, filename) {
  if (!companySlug || typeof companySlug !== "string") {
    throw new Error("Invalid company parameter.");
  }
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename parameter.");
  }

  // Prevent path traversal
  const cleanCompany = path.basename(companySlug);
  const cleanFilename = path.basename(filename);

  const targetPath = path.resolve(OUTPUT_ROOT, cleanCompany, cleanFilename);

  // Must strictly be inside OUTPUT_ROOT
  if (!targetPath.startsWith(OUTPUT_ROOT)) {
    throw new Error("Access denied: path is outside output directory.");
  }

  return targetPath;
}

/**
 * Read artifact JSON or text safely
 */
export async function readArtifact(companySlug, filename) {
  const filePath = resolveSafeArtifactPath(companySlug, filename);
  const content = await fs.readFile(filePath, "utf8");
  if (filename.endsWith(".json")) {
    return JSON.parse(content);
  }
  return content;
}

/**
 * Check if an artifact exists
 */
export async function artifactExists(companySlug, filename) {
  try {
    const filePath = resolveSafeArtifactPath(companySlug, filename);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List previous runs found in output/
 */
export async function listRuns() {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true });
  const runs = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const companyDir = path.join(OUTPUT_ROOT, entry.name);
      try {
        const files = await fs.readdir(companyDir);

        let finalCheck = null;
        let analysis = null;
        let targetTitle = entry.name;
        let targetCompany = entry.name;
        let runDate = (await fs.stat(companyDir)).mtime.toISOString();

        if (files.includes("final-check.json")) {
          try {
            const raw = await fs.readFile(path.join(companyDir, "final-check.json"), "utf8");
            finalCheck = JSON.parse(raw);
            if (finalCheck.target?.title) targetTitle = finalCheck.target.title;
            if (finalCheck.target?.company) targetCompany = finalCheck.target.company;
          } catch {
            // Ignored - optional final-check artifact
          }
        }

        if (files.includes("analysis.json")) {
          try {
            const raw = await fs.readFile(path.join(companyDir, "analysis.json"), "utf8");
            analysis = JSON.parse(raw);
            if (analysis.job?.title) targetTitle = analysis.job.title;
            if (analysis.job?.company) targetCompany = analysis.job.company;
          } catch {
            // Ignored - optional analysis artifact
          }
        }

        runs.push({
          companySlug: entry.name,
          company: targetCompany,
          title: targetTitle,
          status: finalCheck?.status || (files.includes("resume-final.json") ? "pass" : "incomplete"),
          updatedAt: runDate,
          scores: analysis?.scores || null,
          artifacts: files.filter((f) => !f.startsWith(".")),
          hasPreview: files.includes("resume.html"),
          hasPdf: files.includes("resume.pdf"),
        });
      } catch {
        // Skip unreadable directory
      }
    }
  }

  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return runs;
}
