import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { documentFromPdfBbox, documentFromText } from "./layout.mjs";
import { ResumeParserError } from "./errors.mjs";

const textFormats = new Set([".txt", ".md", ".markdown"]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`pdftotext failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}

export async function readResumeSource(inputPath, { extractPdf = run } = {}) {
  const extension = path.extname(inputPath).toLowerCase();
  if (!textFormats.has(extension) && extension !== ".pdf") {
    throw new ResumeParserError("RESUME_FORMAT_UNSUPPORTED", "Unsupported resume format. Use .txt, .md, .markdown, or a text-based .pdf file.", { details: { extension } });
  }
  let document;
  try {
    document = extension === ".pdf"
      ? documentFromPdfBbox(await extractPdf("pdftotext", ["-bbox-layout", inputPath, "-"]))
      : documentFromText(await fs.readFile(inputPath, "utf8"), { format: extension.slice(1) });
  } catch (error) {
    if (error instanceof ResumeParserError) throw error;
    throw new ResumeParserError(
      extension === ".pdf" ? "RESUME_TEXT_EXTRACTION_FAILED" : "RESUME_SOURCE_READ_FAILED",
      extension === ".pdf" ? "Could not extract text from the PDF resume." : "Could not read the resume source.",
      { cause: error, details: { inputPath } }
    );
  }
  if (!document.text) {
    throw new ResumeParserError("RESUME_TEXT_EXTRACTION_FAILED", "The resume contains no extractable text. Scanned PDFs require OCR and are not supported.", { details: { inputPath } });
  }
  return document;
}
