import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const jobPath = process.argv[2];

if (!jobPath) {
  console.error(
    "Usage: node scripts/run.mjs <job.json>"
  );
  process.exit(1);
}

const resumePath = "data/resumes/base.json";
const aliasesPath = "data/aliases.json";
const evidencePath = "data/evidence.json";

function slug(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function run(command, args) {
  console.log(`\n▶ ${command} ${args.join(" ")}\n`);

  await new Promise((resolve, reject) => {
    const child = spawn(
      command,
      args,
      {
        stdio: "inherit",
        shell: false
      }
    );

    child.on(
      "error",
      reject
    );

    child.on(
      "exit",
      code => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `${command} exited with code ${code}`
            )
          );
        }
      }
    );
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const rawJob =
  await fs.readFile(
    jobPath,
    "utf8"
  );

const job =
  JSON.parse(rawJob);

const companySlug =
  slug(job.company);

const titleSlug =
  slug(job.title);

if (!companySlug) {
  throw new Error(
    "Job JSON must contain a valid company."
  );
}

if (!titleSlug) {
  throw new Error(
    "Job JSON must contain a valid title."
  );
}

const outputDir =
  path.join(
    "output",
    companySlug
  );

await fs.mkdir(
  outputDir,
  {
    recursive: true
  }
);

const generatedAnalysisPath =
  path.join(
    "output",
    `${companySlug}-${titleSlug}-analysis.json`
  );

const analysisPath =
  path.join(
    outputDir,
    "analysis.json"
  );

const tailoringPlanPath =
  path.join(
    outputDir,
    "tailoring-plan.json"
  );

const resumeRewrittenPath =
  path.join(
    outputDir,
    "resume-rewritten.json"
  );

const rewriteReportPath =
  path.join(
    outputDir,
    "rewrite-report.json"
  );

const resumeFinalPath =
  path.join(
    outputDir,
    "resume-final.json"
  );

const summaryReportPath =
  path.join(
    outputDir,
    "summary-report.json"
  );

const finalCheckPath =
  path.join(
    outputDir,
    "final-check.json"
  );

console.log(
  `Running pipeline for ${job.company} — ${job.title}`
);

await run(
  "node",
  [
    "scripts/analyse.mjs",
    resumePath,
    jobPath,
    aliasesPath,
    evidencePath
  ]
);

if (
  !(await exists(
    generatedAnalysisPath
  ))
) {
  throw new Error(
    `Expected analysis file not found: ${generatedAnalysisPath}`
  );
}

await fs.copyFile(
  generatedAnalysisPath,
  analysisPath
);

await fs.unlink(
  generatedAnalysisPath
);

console.log(
  `\n✓ Analysis normalized to ${analysisPath}`
);

await run(
  "node",
  [
    "scripts/tailor.mjs",
    resumePath,
    analysisPath,
    aliasesPath,
    evidencePath
  ]
);

if (
  !(await exists(
    tailoringPlanPath
  ))
) {
  throw new Error(
    `Expected tailoring plan not found: ${tailoringPlanPath}`
  );
}

await run(
  "node",
  [
    "scripts/rewrite.mjs",
    resumePath,
    tailoringPlanPath,
    resumeRewrittenPath,
    rewriteReportPath
  ]
);

await run(
  "node",
  [
    "scripts/summary.mjs",
    resumeRewrittenPath,
    tailoringPlanPath,
    resumeFinalPath,
    summaryReportPath
  ]
);

await run(
  "node",
  [
    "scripts/final-check.mjs",
    resumeFinalPath,
    tailoringPlanPath,
    finalCheckPath
  ]
);

const finalCheck =
  JSON.parse(
    await fs.readFile(
      finalCheckPath,
      "utf8"
    )
  );

console.log(
  "\n=============================="
);

console.log(
  "PIPELINE COMPLETE"
);

console.log(
  "=============================="
);

console.log(
  `Target: ${job.company} — ${job.title}`
);

console.log(
  `Output: ${outputDir}/`
);

console.log(
  `Status: ${finalCheck.status}`
);

console.log(
  `Errors: ${finalCheck.counts?.errors ?? 0}`
);

console.log(
  `Warnings: ${finalCheck.counts?.warnings ?? 0}`
);

console.log(
  `Info: ${finalCheck.counts?.info ?? 0}`
);

console.log(
  "\nGenerated files:"
);

for (
  const file of [
    "analysis.json",
    "resume.json",
    "tailoring-plan.json",
    "tailoring-report.json",
    "resume-rewritten.json",
    "rewrite-report.json",
    "resume-final.json",
    "summary-report.json",
    "final-check.json"
  ]
) {
  const filePath =
    path.join(
      outputDir,
      file
    );

  console.log(
    `${await exists(filePath) ? "✓" : "○"} ${filePath}`
  );
}

console.log(
  "\nRendering/theme selection is intentionally not part of this pipeline yet."
);
