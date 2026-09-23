import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/load-config.mjs";
import { extract } from "../lib/job-parser/extract.mjs";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";
import {
  createSemanticProvider,
  describeSemanticProvider,
  getSemanticProviderDiagnostics,
  resolveSemanticProviderName,
} from "../lib/job-parser/providers/index.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";
import { consolidateExtraction } from "../lib/job-parser/consolidate-extraction.mjs";
import { buildParserStatus } from "../lib/job-parser/status.mjs";
import {
  asSemanticStageError,
  isSemanticProviderError,
  semanticProviderError,
} from "../lib/job-parser/providers/errors.mjs";

export function parseArguments(argv) {
  let input;
  let output;
  let semanticProviderName;
  let checkpoint;
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--input" ||
      argument === "--output" ||
      argument === "--semantic-provider"
      || argument === "--checkpoint"
    ) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--input") {
        if (input) throw new Error("--input may be provided only once.");
        input = argv[++index];
      } else if (argument === "--output") {
        if (output) throw new Error("--output may be provided only once.");
        output = argv[++index];
      } else if (argument === "--checkpoint") {
        if (checkpoint) throw new Error("--checkpoint may be provided only once.");
        checkpoint = argv[++index];
      } else {
        if (semanticProviderName)
          throw new Error("--semantic-provider may be provided only once.");
        semanticProviderName = argv[++index];
      }
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length > 1)
    throw new Error("Only one positional input file is allowed.");
  if (input && positional.length)
    throw new Error("Use either positional input or --input, not both.");
  input ??= positional[0];
  if (!input) throw new Error("An input file is required.");
  output ??= path.join(
    "data",
    "jobs",
    `${path.basename(input, path.extname(input))}.json`
  );
  return {
    input,
    output,
    ...(semanticProviderName ? { semanticProviderName } : {}),
    ...(checkpoint ? { checkpoint } : {}),
  };
}

async function writeAtomically(outputPath, value) {
  const directory = path.dirname(outputPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    await fs.writeFile(
      temporary,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8"
    );
    await fs.rename(temporary, outputPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeTextAtomically(outputPath, text) {
  const directory = path.dirname(outputPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    await fs.writeFile(temporary, text, "utf8");
    await fs.rename(temporary, outputPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeProviderAudit(output, providerInfo, config, env, error) {
  if (env.JOB_PARSER_DEBUG !== "1") return;
  let providers = [];
  try {
    providers = getSemanticProviderDiagnostics({
      selected: providerInfo?.name,
      config,
      env,
    });
  } catch {
    // The selected configuration error is already represented below.
  }
  const value = {
    selected: providerInfo ?? { name: "unknown", model: null, used: false },
    providers,
    ...(error
      ? {
          error: {
            code: error.code ?? error.cause?.code ?? "SEMANTIC_PROVIDER_ERROR",
            message: error.message,
          },
        }
      : {}),
  };
  await writeTextAtomically(
    `${output}.provider.json`,
    `${JSON.stringify(value, null, 2)}\n`
  );
}

function normalizeProviderSetupError(error) {
  if (isSemanticProviderError(error)) return error;
  return semanticProviderError(
    "SEMANTIC_PROVIDER_CONFIG_ERROR",
    `Could not load job-parser provider configuration. ${error.message}`,
    { cause: error, stage: "configuration" }
  );
}

export function reportWarnings(warnings, logger = console) {
  const metadataWarnings = warnings.filter(
    (warning) =>
      warning.code === "ambiguous_metadata" && warning.requiresHumanValidation
  );
  for (const warning of metadataWarnings) {
    const others = [
      ...new Set(
        (warning.candidates ?? [])
          .map((candidate) => candidate.value)
          .filter((value) => value !== warning.selected?.value)
      ),
    ];
    logger.warn(
      `[job-parser] HUMAN_VALIDATION_REQUIRED: ${warning.path.slice("/metadata/".length)} selected "${warning.selected?.value}"; other source-backed candidate(s): ${others.map((value) => `"${value}"`).join(", ")}.`
    );
  }
  const remaining = warnings.filter(
    (warning) => !metadataWarnings.includes(warning)
  );
  if (remaining.length)
    logger.warn(
      `[job-parser] ${remaining.length} extraction warning(s): ${JSON.stringify(remaining)}`
    );
}

export async function runJobParser({
  input,
  output,
  semanticProvider,
  semanticProviderName,
  checkpoint,
  config,
  env = process.env,
} = {}) {
  const observability = {
    version: 1,
    runId: `job-parser-${randomUUID()}`,
    startedAt: new Date().toISOString(),
    events: [],
  };
  const recordEvent = (event, details = {}) => {
    observability.events.push({ event, at: new Date().toISOString(), ...details });
  };
  if (!input) throw new Error("INPUT_ERROR: An input file is required.");
  output ??= path.join(
    "data",
    "jobs",
    `${path.basename(input, path.extname(input))}.json`
  );
  if (output) await fs.mkdir(path.dirname(output), { recursive: true });
  recordEvent("parser.started", { input, output });
  console.info(`[job-parser] Reading input: ${input}`);
  let source;
  try {
    source = await fs.readFile(input, "utf8");
  } catch (error) {
    throw new Error(`INPUT_ERROR: Could not read ${input}: ${error.message}`, {
      cause: error,
    });
  }
  console.info(`[job-parser] Read ${source.length} characters.`);
  console.info("[job-parser] Preprocessing job description.");
  const document = preprocessJobDescription(source);
  console.info(
    `[job-parser] Preprocessing complete (${document.sections.length} sections).`
  );
  recordEvent("stage.completed", { stage: "preprocess", sections: document.sections.length });
  console.info("[job-parser] Running deterministic extraction.");
  const deterministic = extract(document);
  console.info(
    `[job-parser] Deterministic extraction complete (${deterministic.extraction.items.length} items, ${deterministic.unresolved.length} unresolved).`
  );
  recordEvent("stage.completed", {
    stage: "deterministic-extraction",
    items: deterministic.extraction.items.length,
    unresolved: deterministic.unresolved.length,
  });
  let extraction = deterministic.extraction;
  const semanticWarnings = [];
  const unresolvedDiagnostics = deterministic.unresolved.map(({ unit, heading, signal, reason }) => ({
    unitId: unit.id,
    sourceSection: heading?.text ?? null,
    signal: signal ?? null,
    reason,
    sourceText: unit.originalText ?? null,
  }));
  let semanticFailure;
  let providerInfo = semanticProvider
    ? { name: "injected", model: null, used: false }
    : undefined;
  if (deterministic.unresolved.length > 0) {
    console.info("[job-parser] Semantic extraction required.");
    if (!semanticProvider) {
      try {
        config ??= loadConfig();
        const selectedName = resolveSemanticProviderName({
          cli: semanticProviderName,
          env,
          ...(checkpoint ? { checkpointPath: checkpoint } : {}),
          config,
        });
        providerInfo = {
          ...describeSemanticProvider(selectedName, config, env),
          used: false,
          status: "selected",
        };
        const selected = createSemanticProvider({
          name: selectedName,
          config,
          env,
          onRawResponse:
            env.JOB_PARSER_DEBUG === "1"
              ? (response) =>
                  writeTextAtomically(
                    `${output}.provider-response.json`,
                    `${response}\n`
                  )
              : undefined,
        });
        semanticProvider = selected.provider;
        providerInfo = { ...selected.info, used: false, status: "selected" };
      } catch (error) {
        const normalizedError = normalizeProviderSetupError(error);
        providerInfo ??= {
          name:
            semanticProviderName ??
            env.JOB_PARSER_PROVIDER ??
            config?.jobParser?.semanticProvider ??
            "unknown",
          model: null,
          capabilities: [],
          used: false,
          status: "misconfigured",
        };
        providerInfo.status = "misconfigured";
        await writeProviderAudit(
          output,
          providerInfo,
          config,
          env,
          normalizedError
        );
        semanticWarnings.push({
          code: "semantic_enrichment_failed",
          stage: "configuration",
          message: normalizedError.message,
          unresolvedUnitIds: deterministic.unresolved.map(({ unit }) => unit.id),
        });
        semanticFailure ??= normalizedError;
      }
    }
    if (!semanticProvider) {
      const error = semanticProviderError(
        "SEMANTIC_PROVIDER_REQUIRED",
        "Unresolved content cannot be parsed while the semantic provider is none."
      );
      if (providerInfo.status !== "misconfigured") providerInfo.status = "disabled";
      await writeProviderAudit(output, providerInfo, config, env, error);
      semanticWarnings.push({
        code: "semantic_enrichment_unavailable",
        stage: "configuration",
        message: error.message,
        unresolvedUnitIds: deterministic.unresolved.map(({ unit }) => unit.id),
      });
      semanticFailure ??= error;
    }
    if (semanticProvider) try {
      console.info(
        `[job-parser] Using semantic provider ${providerInfo.name}${providerInfo.model ? ` (model=${providerInfo.model})` : ""}.`
      );
      extraction = await semanticExtract(
        document,
        deterministic,
        semanticProvider,
        {
          onResponse:
            env.JOB_PARSER_DEBUG === "1"
              ? (response) =>
                  writeTextAtomically(
                    `${output}.intermediate.json`,
                    `${JSON.stringify(response, null, 2)}\n`
                  )
              : undefined,
        }
      );
      semanticWarnings.push(...(extraction.semanticWarnings ?? []));
      providerInfo.used = true;
      providerInfo.status = "succeeded";
      console.info(
        `[job-parser] Semantic extraction complete (${extraction.items.length} items).`
      );
      recordEvent("stage.completed", {
        stage: "semantic-extraction",
        provider: providerInfo.name,
        model: providerInfo.model,
        metrics: extraction.providerReport ?? null,
      });
    } catch (error) {
      providerInfo.status = "failed";
      await writeProviderAudit(output, providerInfo, config, env, error);
      semanticWarnings.push({
        code: "semantic_enrichment_failed",
        stage: "enrichment",
        message: error.message,
        unresolvedUnitIds: deterministic.unresolved.map(({ unit }) => unit.id),
      });
      semanticFailure ??= error;
    }
  }
  if (!providerInfo) {
    config ??= loadConfig();
    const selectedName = resolveSemanticProviderName({
      cli: semanticProviderName,
      env,
      config,
    });
    providerInfo = {
      ...describeSemanticProvider(selectedName, config, env),
      used: false,
      status: "not-needed",
    };
  }
  await writeProviderAudit(output, providerInfo, config, env, semanticFailure);
  if (env.JOB_PARSER_DEBUG === "1" && deterministic.unresolved.length === 0) {
    try {
      await writeTextAtomically(
        `${output}.intermediate.json`,
        `${JSON.stringify(extraction, null, 2)}\n`
      );
      console.info(
        `[job-parser] Debug intermediate extraction written: ${output}.intermediate.json`
      );
    } catch (error) {
      console.warn(
        `[job-parser] Could not write debug intermediate extraction: ${error.message}`
      );
    }
  }
  extraction = consolidateExtraction(document, extraction);
  const evidence = validateEvidence(document, extraction);
  if (!evidence.valid) {
    throw new Error(
      `SEMANTIC_ERROR: Source evidence validation failed: ${JSON.stringify(evidence.errors)}`
    );
  }
  let mapped;
  try {
    console.info("[job-parser] Normalizing and mapping extraction.");
    mapped = mapToJob(normalizeExtraction(extraction));
  } catch (error) {
    throw new Error(`MAPPING_ERROR: ${error.message}`, { cause: error });
  }
  if (!mapped.valid) {
    // Enrichment only degrades gracefully when deterministic output can still
    // satisfy the final job contract (including required identification).
    if (semanticFailure) throw asSemanticStageError(semanticFailure);
    throw new Error(`MAPPING_ERROR: ${JSON.stringify(mapped.errors)}`);
  }
  recordEvent("stage.completed", { stage: "mapping" });
  const warnings = [...(mapped.warnings ?? []), ...semanticWarnings];
  const diagnostics = { unresolved: unresolvedDiagnostics };
  const parser = buildParserStatus({ semanticProvider: providerInfo, warnings, diagnostics });
  if (warnings.length) {
    reportWarnings(warnings);
  }
  try {
    console.info(`[job-parser] Writing validated output: ${output}`);
    await writeAtomically(output, mapped.job);
    await writeAtomically(`${output}.report.json`, {
      version: 1,
      input,
      output,
      provider: providerInfo,
      batches: extraction.providerReport ?? null,
      counts: {
        items: extraction.items?.length ?? 0,
        alternatives: extraction.alternatives?.length ?? 0,
        responsibilities: extraction.responsibilities?.length ?? 0,
        skills: extraction.skills?.length ?? 0,
        coverage: extraction.coverage?.length ?? 0,
      },
      warnings,
      diagnostics,
      parser,
      observability: {
        ...observability,
        completedAt: new Date().toISOString(),
        events: [...observability.events, {
          event: "parser.completed",
          at: new Date().toISOString(),
          artifactPath: output,
        }],
      },
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    throw new Error(
      `OUTPUT_ERROR: Could not write ${output}: ${error.message}`,
      { cause: error }
    );
  }
  console.info("[job-parser] Job parsing completed successfully.");
  return {
    output,
    job: mapped.job,
    semanticProvider: providerInfo,
    warnings,
    diagnostics,
    parser,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runJobParser(options);
    console.log(`Job JSON written to ${result.output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
