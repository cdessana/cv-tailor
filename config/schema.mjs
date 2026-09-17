import { z } from "zod";

const OllamaConfigSchema = z.object({
  model: z.string().default("granite4.2:3b-q4_K_S"),
  url: z
    .string()
    .url("llm.ollama.url must be a valid URL")
    .default("http://127.0.0.1:11434"),
});

const LocalConfigSchema = z.object({
  model: z.string().default("local-model"),
  baseURL: z
    .string()
    .url("llm.local.baseURL must be a valid URL")
    .default("http://127.0.0.1:1234/v1"),
  apiKey: z.string().default("not-needed"),
});

const OpenAIConfigSchema = z.object({
  model: z.string().default("gpt-4o-mini"),
  apiKey: z.string().optional().default(""),
});

const GroqConfigSchema = z.object({
  model: z.string().default("llama-3.1-70b-versatile"),
  baseURL: z
    .string()
    .url("llm.groq.baseURL must be a valid URL")
    .default("https://api.groq.com/openai/v1"),
  apiKey: z.string().optional().default(""),
});

const AnthropicConfigSchema = z.object({
  model: z.string().default("claude-3-5-sonnet-20240620"),
  apiKey: z.string().optional().default(""),
});

const GeminiConfigSchema = z.object({
  model: z.string().default("gemini-1.5-flash"),
  apiKey: z.string().optional().default(""),
});

const JobParserProviderOptionsSchema = z.object({
  model: z.string().min(1),
  timeoutMs: z.number().int().positive().default(120000),
  maxAttempts: z.number().int().positive().max(10).default(3),
  batchSize: z.number().int().positive().max(12).default(3),
  maxCorrections: z.number().int().nonnegative().max(3).default(2),
});

const JobParserOllamaSchema = JobParserProviderOptionsSchema.extend({
  model: z.string().min(1).default("granite4.2:3b-q4_K_S"),
  contextSize: z.number().int().positive().default(16384),
  maxPromptTokens: z.number().int().positive().default(10000),
  responseTokenReserve: z.number().int().nonnegative().default(4000),
  url: z
    .string()
    .url("jobParser.providers.ollama.url must be a valid URL")
    .default("http://127.0.0.1:11434"),
}).prefault({});

const JobParserGeminiSchema = JobParserProviderOptionsSchema.extend({
  model: z.string().min(1).default("gemini-3.1-flash-lite"),
}).prefault({});

export const ConfigSchema = z.object({
  llm: z
    .object({
      provider: z
        .enum(["ollama", "local", "openai", "groq", "anthropic", "gemini"])
        .default("ollama"),
      ollama: OllamaConfigSchema.default({}),
      local: LocalConfigSchema.default({}),
      openai: OpenAIConfigSchema.default({}),
      groq: GroqConfigSchema.default({}),
      anthropic: AnthropicConfigSchema.default({}),
      gemini: GeminiConfigSchema.default({}),
    })
    .default({}),

  jobParser: z
    .object({
      semanticProvider: z.enum(["gemini", "ollama", "none"]).default("none"),
      providers: z
        .object({
          gemini: JobParserGeminiSchema,
          ollama: JobParserOllamaSchema,
        })
        .prefault({}),
    })
    .prefault({}),

  render: z
    .object({
      theme: z.string().default("jsonresume-theme-stackoverflow"),
      browserExecutable: z.string().min(1).optional(),
    })
    .default({}),

  paths: z
    .object({
      baseResume: z.string().default("data/resumes/base.json"),
      evidence: z.string().default("data/evidence.json"),
      aliases: z.string().default("data/aliases.json"),
      jobs: z.string().default("data/jobs"),
      output: z.string().default("output"),
    })
    // `prefault` lets child defaults populate a brand-new workspace. `default({})`
    // returned the empty object unchanged, leaving paths.output undefined.
    .prefault({}),

  pipeline: z
    .object({
      rewriteEnabled: z
        .boolean({
          invalid_type_error: "pipeline.rewriteEnabled must be a boolean",
        })
        .default(true),
      maxBulletsPerRole: z
        .number({
          invalid_type_error: "pipeline.maxBulletsPerRole must be an integer",
        })
        .int("pipeline.maxBulletsPerRole must be an integer")
        .positive("pipeline.maxBulletsPerRole must be a positive integer")
        .default(7),
    })
    .default({}),
});
