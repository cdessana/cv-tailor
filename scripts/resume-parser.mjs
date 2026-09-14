import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readResumeSource } from "../lib/resume-parser/read-source.mjs";
import { parseResumeDocument } from "../lib/resume-parser/parse.mjs";
import { parserErrorPayload, ResumeParserError } from "../lib/resume-parser/errors.mjs";
import { loadConfig } from "../config/load-config.mjs";

async function writeJsonAtomic(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function moveExisting(targetPath, backupPath, fileSystem) {
  try {
    await fileSystem.rename(targetPath, backupPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function writeJsonPairTransactional(candidatePath, candidate, reportPath, report, { fileSystem = fs } = {}) {
  if (path.resolve(candidatePath) === path.resolve(reportPath)) {
    throw new ResumeParserError("RESUME_OUTPUT_PATH_CONFLICT", "The resume candidate and review report must use different paths.", { details: { candidatePath, reportPath } });
  }
  await fileSystem.mkdir(path.dirname(candidatePath), { recursive: true });
  await fileSystem.mkdir(path.dirname(reportPath), { recursive: true });
  const transactionId = `${process.pid}.${randomUUID()}`;
  const candidateTempPath = `${candidatePath}.${transactionId}.tmp`;
  const reportTempPath = `${reportPath}.${transactionId}.tmp`;
  const candidateBackupPath = `${candidatePath}.${transactionId}.bak`;
  const reportBackupPath = `${reportPath}.${transactionId}.bak`;
  let candidateBackedUp = false;
  let reportBackedUp = false;
  let candidateInstalled = false;
  let reportInstalled = false;
  try {
    await Promise.all([
      fileSystem.writeFile(candidateTempPath, `${JSON.stringify(candidate, null, 2)}\n`),
      fileSystem.writeFile(reportTempPath, `${JSON.stringify(report, null, 2)}\n`),
    ]);
    candidateBackedUp = await moveExisting(candidatePath, candidateBackupPath, fileSystem);
    reportBackedUp = await moveExisting(reportPath, reportBackupPath, fileSystem);
    await fileSystem.rename(candidateTempPath, candidatePath);
    candidateInstalled = true;
    await fileSystem.rename(reportTempPath, reportPath);
    reportInstalled = true;
    await Promise.allSettled([
      fileSystem.rm(candidateBackupPath, { force: true }),
      fileSystem.rm(reportBackupPath, { force: true }),
    ]);
  } catch (error) {
    const rollback = [];
    if (candidateInstalled) rollback.push(fileSystem.rm(candidatePath, { force: true }));
    if (reportInstalled) rollback.push(fileSystem.rm(reportPath, { force: true }));
    await Promise.allSettled(rollback);
    const restore = [];
    if (candidateBackedUp) restore.push(fileSystem.rename(candidateBackupPath, candidatePath));
    if (reportBackedUp) restore.push(fileSystem.rename(reportBackupPath, reportPath));
    await Promise.allSettled(restore);
    throw error;
  } finally {
    await Promise.allSettled([
      fileSystem.rm(candidateTempPath, { force: true }),
      fileSystem.rm(reportTempPath, { force: true }),
    ]);
  }
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--input", "--output", "--report"].includes(flag)) throw new ResumeParserError("RESUME_ARGUMENT_ERROR", "Usage: node scripts/resume-parser.mjs --input <resume> --output <candidate.json> [--report <report.json>]");
    options[flag.slice(2)] = value;
  }
  if (!options.input || !options.output) throw new ResumeParserError("RESUME_ARGUMENT_ERROR", "Both --input and --output are required.");
  return { ...options, report: options.report ?? `${options.output}.report.json` };
}

export async function runResumeParser(options, {
  readSource = readResumeSource,
  parseDocument = parseResumeDocument,
  loadConfiguration = loadConfig,
  fileSystem = fs,
} = {}) {
  let config;
  try {
    config = loadConfiguration();
  } catch (error) {
    throw new ResumeParserError("RESUME_CONFIG_ERROR", "Could not load the CV Tailor configuration.", { cause: error });
  }
  const baseResumePath = path.resolve(config.paths.baseResume);
  if (path.resolve(options.output) === baseResumePath) {
    throw new ResumeParserError("RESUME_OUTPUT_PROTECTED", `Refusing to overwrite the configured base resume at ${baseResumePath}. Review the candidate before promoting it manually.`, { details: { baseResumePath } });
  }
  const source = await readSource(options.input);
  const result = parseDocument(source);
  const reportPath = options.report ?? `${options.output}.report.json`;
  if (result.report.status === "failed") {
    try {
      await writeJsonAtomic(reportPath, result.report);
    } catch (error) {
      throw new ResumeParserError("RESUME_REPORT_WRITE_FAILED", "Resume parsing failed and its diagnostic report could not be written.", { cause: error, details: { reportPath } });
    }
    const malformed = result.report.issues.some((issue) => issue.code === "malformed_resume_content");
    const groundingFailed = result.report.issues.some((issue) => issue.kind === "grounding");
    throw new ResumeParserError(
      malformed ? "RESUME_MALFORMED_INPUT" : groundingFailed ? "RESUME_GROUNDING_FAILED" : "RESUME_VALIDATION_FAILED",
      malformed
        ? "The source does not contain enough recognizable resume structure."
        : groundingFailed
          ? "Resume extraction produced values that are not grounded in the source document."
          : "Resume parsing produced an invalid JSON Resume candidate.",
      { details: { reportPath, issues: result.report.issues } }
    );
  }
  try {
    await writeJsonPairTransactional(options.output, result.resume, reportPath, result.report, { fileSystem });
  } catch (error) {
    if (error instanceof ResumeParserError) throw error;
    throw new ResumeParserError("RESUME_OUTPUT_WRITE_FAILED", "Could not write the resume candidate and review report.", { cause: error, details: { output: options.output, reportPath } });
  }
  return { ...result, output: options.output, reportPath };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = await runResumeParser(parseArguments(process.argv.slice(2)));
    console.log(`Resume candidate: ${result.output}`);
    console.log(`Review report: ${result.reportPath}`);
    console.log(`Status: ${result.report.status}`);
  } catch (error) {
    console.error(JSON.stringify(parserErrorPayload(error)));
    process.exitCode = 1;
  }
}
