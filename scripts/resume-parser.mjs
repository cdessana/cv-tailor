import fs from "node:fs/promises";
import path from "node:path";
import { readResumeSource } from "../lib/resume-parser/read-source.mjs";
import { parseResumeDocument } from "../lib/resume-parser/parse.mjs";

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--input", "--output", "--report"].includes(flag)) throw new Error("Usage: node scripts/resume-parser.mjs --input <resume> --output <candidate.json> [--report <report.json>]");
    options[flag.slice(2)] = value;
  }
  if (!options.input || !options.output) throw new Error("Both --input and --output are required.");
  return { ...options, report: options.report ?? `${options.output}.report.json` };
}

export async function runResumeParser(options) {
  const source = await readResumeSource(options.input);
  const result = parseResumeDocument(source);
  if (result.report.status === "failed") throw new Error(`Resume parsing failed: ${result.report.issues.map((issue) => issue.message).join("; ")}`);
  const reportPath = options.report ?? `${options.output}.report.json`;
  const baseResumePath = path.resolve("data/resumes/base.json");
  if (path.resolve(options.output) === baseResumePath) {
    throw new Error("Refusing to overwrite data/resumes/base.json. Review the candidate before promoting it manually.");
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
    throw error;
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
    console.error(error.message);
    process.exitCode = 1;
  }
}
