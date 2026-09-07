import fs from "node:fs/promises";
import path from "node:path";
import { extract } from "../lib/job-parser/extract.mjs";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";

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
  const temporary = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, outputPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function runJobParser({ input, output, semanticProvider } = {}) {
  let source;
  try {
    source = await fs.readFile(input, "utf8");
  } catch (error) {
    throw new Error(`INPUT_ERROR: Could not read ${input}: ${error.message}`);
  }
  const document = preprocessJobDescription(source);
  const deterministic = extract(document);
  let extraction = deterministic.extraction;
  if (deterministic.unresolved.length > 0) {
    if (!semanticProvider) {
      throw new Error("SEMANTIC_ERROR: Unresolved content requires a semantic provider.");
    }
    try {
      extraction = await semanticExtract(document, deterministic, semanticProvider);
    } catch (error) {
      throw new Error(`SEMANTIC_ERROR: ${error.message}`);
    }
  }
  let mapped;
  try {
    mapped = mapToJob(normalizeExtraction(extraction));
  } catch (error) {
    throw new Error(`MAPPING_ERROR: ${error.message}`);
  }
  if (!mapped.valid) {
    throw new Error(`MAPPING_ERROR: ${JSON.stringify(mapped.errors)}`);
  }
  try {
    await writeAtomically(output, mapped.job);
  } catch (error) {
    throw new Error(`OUTPUT_ERROR: Could not write ${output}: ${error.message}`);
  }
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
