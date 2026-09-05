import ollama from "ollama";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadConfig } from "../config/load-config.mjs";

const localConfig = await loadConfig();

export function currentProvider() {
  return process.env.LLM_PROVIDER || localConfig.provider;
}

export async function generateText({
  systemPrompt,
  userPrompt,
  jsonSchema,
  temperature = 0.1,
}) {
  const config = await loadConfig();

  // CLI environment variable override takes precedence over file configuration
  const provider = process.env.LLM_PROVIDER || config.llm.provider;

  // ---------------------------------------------------------
  // OLLAMA
  // ---------------------------------------------------------
  if (provider === "ollama") {
    const response = await ollama.chat({
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
      "dummy-key";

    const client = new OpenAI({
      apiKey,
      baseURL: providerConfig.baseURL, // null/undefined for standard OpenAI
    });

    const response = await client.chat.completions.create({
      model: providerConfig.model,
      temperature,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "resume_schema",
          schema: jsonSchema,
          strict: true,
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return response.choices[0].message.content;
  }

  // ---------------------------------------------------------
  // ANTHROPIC (Claude)
  // ---------------------------------------------------------
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY || config.llm.anthropic.apiKey;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: config.llm.anthropic.model,
      temperature,
      max_tokens: 1024,
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
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: config.llm.gemini.model,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        responseSchema: jsonSchema,
      },
    });

    const response = await model.generateContent(userPrompt);
    return response.response.text();
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
