import fs from "node:fs/promises";
import path from "node:path";
import { ConfigSchema } from "../../config/schema.mjs";
import { loadConfig } from "../../config/load-config.mjs";

const CONFIG_FILE_PATH = path.resolve(process.cwd(), "cv-tailor.config.json");

/**
 * Mask an API key string for safe transmission to client.
 */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return "";
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 3)}••••••••${trimmed.slice(-3)}`;
}

/**
 * Read raw config file directly from disk without resolving paths to absolute paths.
 */
export async function readRawConfigFile() {
  try {
    const raw = await fs.readFile(CONFIG_FILE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/**
 * Get sanitized configuration for the frontend UI.
 * Never exposes raw secret API keys.
 */
export async function getSanitizedConfig() {
  const raw = await readRawConfigFile();
  const parsed = ConfigSchema.safeParse(raw);
  const data = parsed.success ? parsed.data : ConfigSchema.parse({});

  const sanitized = JSON.parse(JSON.stringify(data));

  // Sanitize LLM API keys
  if (sanitized.llm) {
    const providers = ["openai", "groq", "anthropic", "gemini", "local"];
    for (const prov of providers) {
      if (sanitized.llm[prov]) {
        const hasKey = Boolean(
          sanitized.llm[prov].apiKey ||
            process.env[`${prov.toUpperCase()}_API_KEY`]
        );
        sanitized.llm[prov].apiKeyConfigured = hasKey;
        sanitized.llm[prov].apiKeyMasked = maskApiKey(sanitized.llm[prov].apiKey);
        // Do not expose plaintext apiKey
        delete sanitized.llm[prov].apiKey;
      }
    }
  }

  return sanitized;
}

/**
 * Update configuration safely with partial updates and API key protection.
 */
export async function updateConfig(updates = {}) {
  const currentRaw = await readRawConfigFile();
  const parsedCurrent = ConfigSchema.safeParse(currentRaw);
  const current = parsedCurrent.success ? parsedCurrent.data : ConfigSchema.parse({});

  const merged = JSON.parse(JSON.stringify(current));

  // Merge LLM config
  if (updates.llm && typeof updates.llm === "object") {
    if (updates.llm.provider) {
      merged.llm.provider = updates.llm.provider;
    }

    const provKeys = ["ollama", "local", "openai", "groq", "anthropic", "gemini"];
    for (const prov of provKeys) {
      if (updates.llm[prov] && typeof updates.llm[prov] === "object") {
        merged.llm[prov] = merged.llm[prov] || {};
        for (const [key, val] of Object.entries(updates.llm[prov])) {
          if (key === "apiKey") {
            // Only update API key if a non-empty string is provided
            // or if clearApiKey flag is set
            if (updates.llm[prov].clearApiKey) {
              merged.llm[prov].apiKey = "";
            } else if (typeof val === "string" && val.trim().length > 0 && !val.includes("••••")) {
              merged.llm[prov].apiKey = val.trim();
            }
          } else if (key !== "clearApiKey" && key !== "apiKeyConfigured" && key !== "apiKeyMasked") {
            merged.llm[prov][key] = val;
          }
        }
      }
    }
  }

  // Merge Job Parser config
  if (updates.jobParser && typeof updates.jobParser === "object") {
    if (updates.jobParser.semanticProvider) {
      merged.jobParser.semanticProvider = updates.jobParser.semanticProvider;
    }
    if (updates.jobParser.providers && typeof updates.jobParser.providers === "object") {
      merged.jobParser.providers = merged.jobParser.providers || {};
      for (const [pName, pConfig] of Object.entries(updates.jobParser.providers)) {
        if (pConfig && typeof pConfig === "object") {
          merged.jobParser.providers[pName] = {
            ...(merged.jobParser.providers[pName] || {}),
            ...pConfig,
          };
        }
      }
    }
  }

  // Merge Pipeline config
  if (updates.pipeline && typeof updates.pipeline === "object") {
    if (typeof updates.pipeline.rewriteEnabled === "boolean") {
      merged.pipeline.rewriteEnabled = updates.pipeline.rewriteEnabled;
    }
    if (typeof updates.pipeline.maxBulletsPerRole === "number") {
      merged.pipeline.maxBulletsPerRole = updates.pipeline.maxBulletsPerRole;
    }
  }

  // Merge Render config
  if (updates.render && typeof updates.render === "object") {
    if (typeof updates.render.theme === "string") {
      merged.render.theme = updates.render.theme;
    }
    if (typeof updates.render.browserExecutable === "string") {
      merged.render.browserExecutable = updates.render.browserExecutable;
    }
  }

  // Merge Paths config (if valid)
  if (updates.paths && typeof updates.paths === "object") {
    for (const [k, v] of Object.entries(updates.paths)) {
      if (typeof v === "string" && v.trim().length > 0) {
        merged.paths[k] = v.trim();
      }
    }
  }

  // Validate merged config against Schema
  const validationResult = ConfigSchema.safeParse(merged);
  if (!validationResult.success) {
    const errorDetails = validationResult.error.issues
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${errorDetails}`);
  }

  // Write atomically
  const tempPath = `${CONFIG_FILE_PATH}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(validationResult.data, null, 2), "utf8");
  await fs.rename(tempPath, CONFIG_FILE_PATH);

  return getSanitizedConfig();
}
