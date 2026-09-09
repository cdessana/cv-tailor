import { Ollama } from "ollama";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadConfig } from "../config/load-config.mjs";

export function currentModel() {
  const localConfig = loadConfig();
  const provider = process.env.LLM_PROVIDER || localConfig.llm.provider;

  if (provider === "ollama" && process.env.OLLAMA_MODEL) {
    return process.env.OLLAMA_MODEL;
  }

  return localConfig.llm[provider]?.model || provider;
}

function requireText(content, provider) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${provider} returned an empty text response.`);
  }

  return content;
}

/**
 * Gemini's legacy SDK accepts its own SchemaType wire values rather than
 * ordinary JSON Schema's lowercase values. Keep the application schema as
 * JSON Schema and adapt it only at the provider boundary.
 */
export function adaptGeminiSchema(jsonSchema) {
  const schemaTypes = {
    array: "ARRAY",
    boolean: "BOOLEAN",
    integer: "INTEGER",
    number: "NUMBER",
    object: "OBJECT",
    string: "STRING",
  };

  return JSON.parse(
    JSON.stringify(jsonSchema, (key, value) => {
      if (key === "additionalProperties") return undefined;
      if (key === "type" && typeof value === "string") {
        return schemaTypes[value] ?? value;
      }
      return value;
    })
  );
}

/**
 * Accept a JSON object returned directly, in a Markdown fence, or after a
 * short provider preface. The scanner respects quoted braces, unlike a greedy
 * regular expression, and preserves the validation performed by callers.
 */
export function parseJsonObject(rawResponse) {
  const text = String(rawResponse ?? "").trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // A compatible provider may add prose or Markdown around the JSON object.
  }

  for (
    let start = text.indexOf("{");
    start !== -1;
    start = text.indexOf("{", start + 1)
  ) {
    let depth = 0;
    let escaped = false;
    let quoted = false;

    for (let index = start; index < text.length; index += 1) {
      const character = text[index];

      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }

      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error("Model response did not contain a valid JSON object.");
}

export async function generateText({
  systemPrompt,
  userPrompt,
  jsonSchema,
  temperature = 0.1,
}) {
  const config = loadConfig();

  // CLI environment variable override takes precedence over file configuration
  const provider = process.env.LLM_PROVIDER || config.llm.provider;

  // ---------------------------------------------------------
  // OLLAMA
  // ---------------------------------------------------------
  if (provider === "ollama") {
    const ollamaClient = new Ollama({
      host: process.env.OLLAMA_HOST || config.llm.ollama.url,
    });
    const response = await ollamaClient.chat({
      model: process.env.OLLAMA_MODEL || config.llm.ollama.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      format: jsonSchema,
      options: { temperature },
    });
    return requireText(response.message?.content, "Ollama");
  }

  // ---------------------------------------------------------
  // OPENAI, GROQ & LOCAL (OpenAI-compatible)
  // ---------------------------------------------------------
  if (["openai", "groq", "local"].includes(provider)) {
    const providerConfig = config.llm[provider];
    const apiKey =
      process.env[`${provider.toUpperCase()}_API_KEY`] ||
      providerConfig.apiKey ||
      (provider === "local" ? "dummy-key" : "");

    if (!apiKey) {
      throw new Error(
        `Missing API key for ${provider} provider. Set ${provider.toUpperCase()}_API_KEY or configure llm.${provider}.apiKey.`
      );
    }
    const client = new OpenAI({
      apiKey,
      baseURL: providerConfig.baseURL, // null/undefined for standard OpenAI
    });

    const responseFormat =
      provider === "openai"
        ? {
            type: "json_schema",
            json_schema: {
              name: "resume_schema",
              schema: jsonSchema,
              strict: true,
            },
          }
        : { type: "json_object" };

    const effectiveUserPrompt =
      provider === "openai"
        ? userPrompt
        : `${userPrompt}\n\nRespond ONLY with valid JSON matching this schema: ${JSON.stringify(jsonSchema)}`;

    const response = await client.chat.completions.create({
      model: providerConfig.model,
      temperature,
      response_format: responseFormat,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: effectiveUserPrompt },
      ],
    });
    return requireText(response.choices[0]?.message?.content, provider);
  }

  // ---------------------------------------------------------
  // ANTHROPIC (Claude)
  // ---------------------------------------------------------
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY || config.llm.anthropic.apiKey;
    if (!apiKey) {
      throw new Error(
        "Missing API key for Anthropic provider. Set ANTHROPIC_API_KEY or configure llm.anthropic.apiKey."
      );
    }
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: config.llm.anthropic.model,
      temperature,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `${userPrompt}\n\nRespond ONLY with valid JSON matching this schema: ${JSON.stringify(jsonSchema)}`,
        },
      ],
    });
    const textBlock = response.content.find((block) => block.type === "text");
    return requireText(textBlock?.text, "Anthropic");
  }

  // ---------------------------------------------------------
  // GOOGLE GEMINI
  // ---------------------------------------------------------
  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY || config.llm.gemini.apiKey;
    if (!apiKey) {
      throw new Error(
        "Missing API key for Gemini provider. Set GEMINI_API_KEY or configure llm.gemini.apiKey."
      );
    }
    const genAI = new GoogleGenerativeAI(apiKey);

    const sanitizedSchema = adaptGeminiSchema(jsonSchema);

    const model = genAI.getGenerativeModel({
      model: config.llm.gemini.model,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        responseSchema: sanitizedSchema,
      },
    });

    const response = await model.generateContent(userPrompt);
    return requireText(response.response.text(), "Gemini");
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
