import fs from "node:fs/promises";
import path from "node:path";
import { readResumeSource } from "../lib/resume-parser/read-source.mjs";
import { parseResumeDocument } from "../lib/resume-parser/parse.mjs";
import { parserErrorPayload, ResumeParserError } from "../lib/resume-parser/errors.mjs";

async function writeJsonAtomic(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
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

export async function runResumeParser(options, { readSource = readResumeSource, parseDocument = parseResumeDocument } = {}) {
  const source = await readSource(options.input);
  const result = parseDocument(source);
  const reportPath = options.report ?? `${options.output}.report.json`;
  if (result.report.status === "failed") {
    try {
      await writeJsonAtomic(reportPath, result.report);
    } catch (error) {
      throw new ResumeParserError("RESUME_REPORT_WRITE_FAILED", "Resume parsing failed and its diagnostic report could not be written.", { cause: error, details: { reportPath } });
    }
    throw new ResumeParserError("RESUME_VALIDATION_FAILED", "Resume parsing produced an invalid JSON Resume candidate.", { details: { reportPath, issues: result.report.issues } });
  }
  const baseResumePath = path.resolve("data/resumes/base.json");
  if (path.resolve(options.output) === baseResumePath) {
    throw new ResumeParserError("RESUME_OUTPUT_PROTECTED", "Refusing to overwrite data/resumes/base.json. Review the candidate before promoting it manually.");
  }
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const candidateTempPath = `${options.output}.${process.pid}.tmp`;
  const reportTempPath = `${reportPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(candidateTempPath, `${JSON.stringify(result.resume, null, 2)}\n`);
    await fs.writeFile(reportTempPath, `${JSON.stringify(result.report, null, 2)}\n`);
    await fs.rename(candidateTempPath, options.output);
    await fs.rename(reportTempPath, reportPath);
  } catch (error) {
    await Promise.all([fs.rm(candidateTempPath, { force: true }), fs.rm(reportTempPath, { force: true })]);
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
