import fs from "node:fs/promises";
import path from "node:path";
import { extract } from "../lib/job-parser/extract.mjs";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";

export function parseArguments(argv) {
  let input;
  let output;
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input" || argument === "--output") {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--input") {
        if (input) throw new Error("--input may be provided only once.");
        input = argv[++index];
      } else {
        if (output) throw new Error("--output may be provided only once.");
        output = argv[++index];
      }
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length > 1) throw new Error("Only one positional input file is allowed.");
  if (input && positional.length) throw new Error("Use either positional input or --input, not both.");
  input ??= positional[0];
  if (!input) throw new Error("An input file is required.");
  output ??= path.join("data", "jobs", `${path.basename(input, path.extname(input))}.json`);
  return { input, output };
}

async function writeAtomically(outputPath, value) {
  const directory = path.dirname(outputPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, outputPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeTextAtomically(outputPath, text) {
  const directory = path.dirname(outputPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await fs.writeFile(temporary, text, "utf8");
    await fs.rename(temporary, outputPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function runJobParser({ input, output, semanticProvider } = {}) {
  // A failed replacement must not leave an older job looking like the result
  // of the current run.
  if (output) await fs.mkdir(path.dirname(output), { recursive: true });
  console.info(`[job-parser] Reading input: ${input}`);
  let source;
  try {
    source = await fs.readFile(input, "utf8");
  } catch (error) {
    throw new Error(`INPUT_ERROR: Could not read ${input}: ${error.message}`);
  }
  console.info(`[job-parser] Read ${source.length} characters.`);
  console.info("[job-parser] Preprocessing job description.");
  const document = preprocessJobDescription(source);
  console.info(`[job-parser] Preprocessing complete (${document.sections.length} sections).`);
  console.info("[job-parser] Running deterministic extraction.");
  const deterministic = extract(document);
  console.info(`[job-parser] Deterministic extraction complete (${deterministic.extraction.items.length} items, ${deterministic.unresolved.length} unresolved).`);
  let extraction = deterministic.extraction;
  if (deterministic.unresolved.length > 0) {
    console.info("[job-parser] Semantic extraction required.");
    semanticProvider ??= process.env.GEMINI_API_KEY ? createGeminiProvider({
      onRawResponse: process.env.JOB_PARSER_DEBUG === "1"
        ? (response) => writeTextAtomically(`${output}.provider-response.json`, `${response}\n`)
        : undefined,
    }) : undefined;
    if (!semanticProvider) {
      throw new Error("SEMANTIC_ERROR: Unresolved content requires a semantic provider.");
    }
    try {
      extraction = await semanticExtract(document, deterministic, semanticProvider, {
        onResponse: process.env.JOB_PARSER_DEBUG === "1"
          ? (response) => writeTextAtomically(`${output}.intermediate.json`, `${JSON.stringify(response, null, 2)}\n`)
          : undefined,
      });
      console.info(`[job-parser] Semantic extraction complete (${extraction.items.length} items).`);
    } catch (error) {
      throw new Error(`SEMANTIC_ERROR: ${error.message}`);
    }
  }
  if (process.env.JOB_PARSER_DEBUG === "1" && deterministic.unresolved.length === 0) {
    try {
      await writeTextAtomically(`${output}.intermediate.json`, `${JSON.stringify(extraction, null, 2)}\n`);
      console.info(`[job-parser] Debug intermediate extraction written: ${output}.intermediate.json`);
    } catch (error) {
      console.warn(`[job-parser] Could not write debug intermediate extraction: ${error.message}`);
    }
  }
  let mapped;
  try {
    console.info("[job-parser] Normalizing and mapping extraction.");
    mapped = mapToJob(normalizeExtraction(extraction));
  } catch (error) {
    throw new Error(`MAPPING_ERROR: ${error.message}`);
  }
  if (!mapped.valid) {
    throw new Error(`MAPPING_ERROR: ${JSON.stringify(mapped.errors)}`);
  }
  if (mapped.warnings?.length) {
    console.warn(`[job-parser] ${mapped.warnings.length} extraction warning(s): ${JSON.stringify(mapped.warnings)}`);
  }
  try {
    console.info(`[job-parser] Writing validated output: ${output}`);
    await writeAtomically(output, mapped.job);
  } catch (error) {
    throw new Error(`OUTPUT_ERROR: Could not write ${output}: ${error.message}`);
  }
  console.info("[job-parser] Job parsing completed successfully.");
  return { output, job: mapped.job };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runJobParser(options);
    console.log(`Job JSON written to ${result.output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
