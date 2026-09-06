import { Ollama } from "ollama";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadConfig } from "../config/load-config.mjs";

export function currentModel() {
  const localConfig = loadConfig();
  const provider = process.env.LLM_PROVIDER || localConfig.llm.provider;
  return localConfig.llm[provider]?.model || provider;
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
    return response.message.content;
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
    return response.choices[0].message.content;
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
    return response.content[0].text;
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

    const sanitizedSchema = JSON.parse(
      JSON.stringify(jsonSchema, (key, value) =>
        key === "additionalProperties" ? undefined : value
      )
    );

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
    return response.response.text();
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
