import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigSchema } from "../config/schema.mjs";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { createOllamaProvider } from "../lib/job-parser/providers/ollama.mjs";
import {
  createSemanticProvider,
  getSemanticProviderDiagnostics,
  resolveSemanticProviderName,
  resolveSemanticProviderOptions,
} from "../lib/job-parser/providers/index.mjs";
import { runJobParser } from "../scripts/job-parser.mjs";
import { SemanticProviderError } from "../lib/job-parser/providers/errors.mjs";

test("job-parser provider selection follows CLI, environment, config, then default precedence", () => {
  const config = { jobParser: { semanticProvider: "ollama" } };
  assert.equal(
    resolveSemanticProviderName({
      cli: "none",
      env: { JOB_PARSER_PROVIDER: "gemini" },
      config,
    }),
    "none"
  );
  assert.equal(
    resolveSemanticProviderName({
      env: { JOB_PARSER_PROVIDER: "gemini" },
      config,
    }),
    "gemini"
  );
  assert.equal(resolveSemanticProviderName({ env: {}, config }), "ollama");
  assert.equal(resolveSemanticProviderName({ env: {}, config: {} }), "none");
  assert.throws(
    () => resolveSemanticProviderName({ cli: "unknown", env: {}, config }),
    /SEMANTIC_PROVIDER_CONFIG_ERROR/
  );
});

test("configuration keeps job parsing independent from resume rewriting", () => {
  const config = ConfigSchema.parse({
    llm: { provider: "ollama" },
    jobParser: { semanticProvider: "gemini" },
  });
  assert.equal(config.llm.provider, "ollama");
  assert.equal(config.jobParser.semanticProvider, "gemini");
  assert.equal(
    config.jobParser.providers.gemini.model,
    "gemini-3.1-flash-lite"
  );
});

test("none creates no provider and performs no network setup", () => {
  const selected = createSemanticProvider({ name: "none", config: {} });
  assert.equal(selected.provider, null);
  assert.equal(selected.info.name, "none");
  assert.equal(selected.info.model, null);
  assert.deepEqual(selected.info.capabilities, ["deterministic-only"]);
});

test("provider-specific environment values override validated configuration", () => {
  const config = ConfigSchema.parse({
    jobParser: { semanticProvider: "gemini" },
  });
  const gemini = resolveSemanticProviderOptions("gemini", config, {
    GEMINI_MODEL: "gemini-env-model",
    GEMINI_TIMEOUT_MS: "9000",
    GEMINI_MAX_ATTEMPTS: "2",
    GEMINI_BATCH_SIZE: "4",
    GEMINI_MAX_CORRECTIONS: "0",
  });
  assert.deepEqual(
    {
      model: gemini.model,
      timeoutMs: gemini.timeoutMs,
      maxAttempts: gemini.maxAttempts,
      batchSize: gemini.batchSize,
      maxCorrections: gemini.maxCorrections,
    },
    {
      model: "gemini-env-model",
      timeoutMs: 9000,
      maxAttempts: 2,
      batchSize: 4,
      maxCorrections: 0,
    }
  );
  const ollama = resolveSemanticProviderOptions("ollama", config, {
    OLLAMA_MODEL: "ollama-env-model",
    OLLAMA_HOST: "http://127.0.0.1:22434",
    JOB_PARSER_OLLAMA_CONTEXT_SIZE: "32768",
  });
  assert.equal(ollama.model, "ollama-env-model");
  assert.equal(ollama.url, "http://127.0.0.1:22434");
  assert.equal(ollama.contextSize, 32768);
  assert.throws(
    () =>
      resolveSemanticProviderOptions("gemini", config, {
        GEMINI_TIMEOUT_MS: "invalid",
      }),
    /SEMANTIC_PROVIDER_CONFIG_ERROR/
  );
});

test("non-numeric provider environment values use the configuration error category", () => {
  const config = ConfigSchema.parse({});
  for (const [provider, env] of [
    ["gemini", { GEMINI_TIMEOUT_MS: "not-a-number" }],
    ["ollama", { JOB_PARSER_OLLAMA_MAX_ATTEMPTS: "not-a-number" }],
  ]) {
    assert.throws(
      () => resolveSemanticProviderOptions(provider, config, env),
      (error) =>
        error instanceof SemanticProviderError &&
        error.code === "SEMANTIC_PROVIDER_CONFIG_ERROR" &&
        /must be a positive integer/u.test(error.message)
    );
  }
});

test("diagnostics expose capabilities, selection, and missing setup without secrets", () => {
  const config = ConfigSchema.parse({
    jobParser: { semanticProvider: "gemini" },
  });
  const diagnostics = getSemanticProviderDiagnostics({
    selected: "gemini",
    config,
    env: {},
  });
  const gemini = diagnostics.find((provider) => provider.name === "gemini");
  assert.equal(gemini.selected, true);
  assert.equal(gemini.configured, false);
  assert.equal(gemini.availability, "misconfigured");
  assert.match(gemini.issue, /GEMINI_API_KEY/u);
  assert.ok(!JSON.stringify(diagnostics).includes("secret-value"));
});

test("Gemini setup failures are exposed through a provider-neutral error", () => {
  assert.throws(
    () =>
      createSemanticProvider({
        name: "gemini",
        config: ConfigSchema.parse({
          jobParser: { semanticProvider: "gemini" },
        }),
        dependencies: { apiKey: "" },
      }),
    /SEMANTIC_PROVIDER_CONFIG_ERROR/
  );
});

test("Ollama uses structured output and retries locally invalid responses", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  const valid = {
    blocks: [
      {
        id: "unit-13-38",
        status: "extracted",
        records: [
          {
            recordType: "item",
            metadataKey: "none",
            value: "Modern cloud experience",
            values: [],
            kind: "requirement",
            classification: "required",
            quote: "Modern cloud experience",
            examples: [],
          },
        ],
        reason: "",
      },
    ],
  };
  const requests = [];
  const provider = createOllamaProvider({
    model: "test-model",
    maxAttempts: 1,
    maxCorrections: 1,
    chat: async (request) => {
      requests.push(request);
      return {
        message: {
          content: JSON.stringify(
            requests.length === 1 ? { blocks: [] } : valid
          ),
        },
      };
    },
    logger: {},
  });
  const extraction = await provider({
    ...document,
    unresolved: [{ unitId: "unit-13-38" }],
  });
  assert.equal(extraction.items[0].value, "Modern cloud experience");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "test-model");
  assert.equal(requests[0].think, false);
  assert.equal(requests[0].options.num_ctx, 16384);
  assert.deepEqual(requests[0].format.required, ["blocks"]);
  assert.match(requests[1].messages[1].content, /local validation feedback/u);
});

test("Ollama model-not-found failures are actionable, neutral, and not retried", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  const config = ConfigSchema.parse({
    jobParser: {
      semanticProvider: "ollama",
      providers: { ollama: { model: "missing-model" } },
    },
  });
  let calls = 0;
  const selected = createSemanticProvider({
    name: "ollama",
    config,
    env: {},
    dependencies: {
      chat: async () => {
        calls += 1;
        const error = new Error("model 'missing-model' not found");
        error.status_code = 404;
        error.error = error.message;
        throw error;
      },
    },
  });
  await assert.rejects(
    () =>
      selected.provider({
        ...document,
        unresolved: [{ unitId: "unit-13-38" }],
      }),
    (error) =>
      error.code === "SEMANTIC_PROVIDER_CONFIG_ERROR" &&
      /ollama pull missing-model/u.test(error.message)
  );
  assert.equal(calls, 1);
});

test("none fails unresolved parsing without replacing an existing output", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "job-parser-none-")
  );
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nCandidate profile\n- Modern cloud experience", "utf8");
  await fs.writeFile(output, '{"company":"Previous","title":"Job"}\n', "utf8");
  const config = ConfigSchema.parse({
    jobParser: { semanticProvider: "none" },
  });
  await assert.rejects(
    () => runJobParser({ input, output, config, env: {} }),
    (error) =>
      error instanceof SemanticProviderError &&
      error.code === "SEMANTIC_PROVIDER_REQUIRED" &&
      /SEMANTIC_ERROR/u.test(error.message)
  );
  assert.equal(
    await fs.readFile(output, "utf8"),
    '{"company":"Previous","title":"Job"}\n'
  );
});

test("debug audit records a disabled provider failure before accepted output", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "job-parser-audit-")
  );
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nCandidate profile\n- Modern cloud experience", "utf8");
  const config = ConfigSchema.parse({
    jobParser: { semanticProvider: "none" },
  });
  await assert.rejects(
    () =>
      runJobParser({ input, output, config, env: { JOB_PARSER_DEBUG: "1" } }),
    /SEMANTIC_PROVIDER_REQUIRED/
  );
  const audit = JSON.parse(
    await fs.readFile(`${output}.provider.json`, "utf8")
  );
  assert.equal(audit.selected.name, "none");
  assert.equal(audit.selected.status, "disabled");
  assert.equal(audit.error.code, "SEMANTIC_PROVIDER_REQUIRED");
  await assert.rejects(() => fs.access(output));
});

test("debug audit records provider misconfiguration without credentials", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "job-parser-config-audit-")
  );
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nCandidate profile\n- Modern cloud experience", "utf8");
  const config = ConfigSchema.parse({
    jobParser: { semanticProvider: "gemini" },
  });
  await assert.rejects(
    () =>
      runJobParser({ input, output, config, env: { JOB_PARSER_DEBUG: "1" } }),
    /SEMANTIC_PROVIDER_CONFIG_ERROR/
  );
  const audit = JSON.parse(
    await fs.readFile(`${output}.provider.json`, "utf8")
  );
  assert.equal(audit.selected.name, "gemini");
  assert.equal(audit.selected.status, "misconfigured");
  assert.equal(audit.error.code, "SEMANTIC_PROVIDER_CONFIG_ERROR");
  assert.equal(
    audit.providers.find((provider) => provider.name === "gemini").availability,
    "misconfigured"
  );
  await assert.rejects(() => fs.access(output));
});

test("configuration-file validation failures use the provider configuration category", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "job-parser-invalid-config-")
  );
  const input = path.join(directory, "job.txt");
  const output = path.join(directory, "job.json");
  await fs.writeFile(input, "Example is hiring a Senior Engineer\nCandidate profile\n- Modern cloud experience", "utf8");
  await fs.writeFile(
    path.join(directory, "cv-tailor.config.json"),
    JSON.stringify({
      jobParser: { providers: { ollama: { url: "not-a-url" } } },
    }),
    "utf8"
  );
  const previousConfigPath = process.env.CV_TAILOR_CONFIG;
  process.env.CV_TAILOR_CONFIG = path.join(directory, "cv-tailor.config.json");
  try {
    await assert.rejects(
      () => runJobParser({ input, output, env: { JOB_PARSER_DEBUG: "1" } }),
      (error) =>
        error instanceof SemanticProviderError &&
        error.code === "SEMANTIC_PROVIDER_CONFIG_ERROR"
    );
    const audit = JSON.parse(
      await fs.readFile(`${output}.provider.json`, "utf8")
    );
    assert.equal(audit.error.code, "SEMANTIC_PROVIDER_CONFIG_ERROR");
    await assert.rejects(() => fs.access(output));
  } finally {
    if (previousConfigPath === undefined) delete process.env.CV_TAILOR_CONFIG;
    else process.env.CV_TAILOR_CONFIG = previousConfigPath;
  }
});
