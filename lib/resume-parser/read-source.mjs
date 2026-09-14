import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { documentFromPdfBbox, documentFromText } from "./layout.mjs";

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
    throw new Error("Unsupported resume format. Use .txt, .md, .markdown, or a text-based .pdf file.");
  }
  const document = extension === ".pdf"
    ? documentFromPdfBbox(await extractPdf("pdftotext", ["-bbox-layout", inputPath, "-"]))
    : documentFromText(await fs.readFile(inputPath, "utf8"), { format: extension.slice(1) });
  if (!document.text) {
    throw new Error("The resume contains no extractable text. Scanned PDFs require OCR and are not supported.");
  }
  return document;
}
