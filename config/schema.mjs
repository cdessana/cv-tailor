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

  render: z
    .object({
      theme: z.string().default("jsonresume-theme-stackoverflow"),
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
    .default({}),

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
