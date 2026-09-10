import { createGeminiProvider } from "./gemini.mjs";
import { createOllamaProvider } from "./ollama.mjs";
import { semanticProviderError } from "./errors.mjs";

function numericOverride(env, name, { allowZero = false } = {}) {
  if (env[name] === undefined || env[name] === "") return undefined;
  const value = Number(env[name]);
  const valid = Number.isInteger(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) {
    throw semanticProviderError(
      "SEMANTIC_PROVIDER_CONFIG_ERROR",
      `${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`,
      { stage: "configuration" }
    );
  }
  return value;
}

function mapNativeError(error) {
  const suffix = String(error?.code ?? "").replace(/^(?:GEMINI|OLLAMA)_/u, "");
  if (["CONFIG_ERROR", "MODEL_NOT_FOUND"].includes(suffix))
    return "SEMANTIC_PROVIDER_CONFIG_ERROR";
  if (suffix === "AUTH_ERROR") return "SEMANTIC_PROVIDER_AUTH_ERROR";
  if (suffix === "TIMEOUT") return "SEMANTIC_PROVIDER_TIMEOUT";
  if (suffix === "RATE_LIMIT") return "SEMANTIC_PROVIDER_RATE_LIMIT";
  if (["SCHEMA_ERROR", "EVIDENCE_ERROR", "RESPONSE_ERROR"].includes(suffix))
    return "SEMANTIC_PROVIDER_RESPONSE_ERROR";
  return "SEMANTIC_PROVIDER_REQUEST_ERROR";
}

const sharedCapabilities = Object.freeze([
  "structured-output",
  "block-accounting",
  "source-evidence",
  "correction",
]);

const descriptors = {
  gemini: {
    capabilities: sharedCapabilities,
    resolveOptions(config, env) {
      const configured = config?.jobParser?.providers?.gemini ?? {};
      return {
        ...configured,
        model: env.GEMINI_MODEL || configured.model,
        timeoutMs:
          numericOverride(env, "GEMINI_TIMEOUT_MS") ?? configured.timeoutMs,
        maxAttempts:
          numericOverride(env, "GEMINI_MAX_ATTEMPTS") ?? configured.maxAttempts,
        batchSize:
          numericOverride(env, "GEMINI_BATCH_SIZE") ?? configured.batchSize,
        maxCorrections:
          numericOverride(env, "GEMINI_MAX_CORRECTIONS", { allowZero: true }) ??
          configured.maxCorrections,
      };
    },
    diagnose(env) {
      return env.GEMINI_API_KEY
        ? { configured: true, availability: "not-checked" }
        : {
            configured: false,
            availability: "misconfigured",
            issue: "GEMINI_API_KEY is not configured.",
          };
    },
    create(options, env, dependencies) {
      return createGeminiProvider({
        ...options,
        apiKey: dependencies.apiKey ?? env.GEMINI_API_KEY,
        fetchImpl: dependencies.fetchImpl,
      });
    },
    mapError: mapNativeError,
  },
  ollama: {
    capabilities: sharedCapabilities,
    resolveOptions(config, env) {
      const configured = config?.jobParser?.providers?.ollama ?? {};
      return {
        ...configured,
        model:
          env.JOB_PARSER_OLLAMA_MODEL || env.OLLAMA_MODEL || configured.model,
        url: env.JOB_PARSER_OLLAMA_HOST || env.OLLAMA_HOST || configured.url,
        timeoutMs:
          numericOverride(env, "JOB_PARSER_OLLAMA_TIMEOUT_MS") ??
          configured.timeoutMs,
        maxAttempts:
          numericOverride(env, "JOB_PARSER_OLLAMA_MAX_ATTEMPTS") ??
          configured.maxAttempts,
        batchSize:
          numericOverride(env, "JOB_PARSER_OLLAMA_BATCH_SIZE") ??
          configured.batchSize,
        maxCorrections:
          numericOverride(env, "JOB_PARSER_OLLAMA_MAX_CORRECTIONS", {
            allowZero: true,
          }) ?? configured.maxCorrections,
      };
    },
    diagnose() {
      return { configured: true, availability: "not-checked" };
    },
    create(options, _env, dependencies) {
      return createOllamaProvider({
        ...options,
        chat: dependencies.chat,
        fetchImpl: dependencies.fetchImpl,
      });
    },
    mapError: mapNativeError,
  },
  none: {
    capabilities: Object.freeze(["deterministic-only"]),
    resolveOptions() {
      return {};
    },
    diagnose() {
      return { configured: true, availability: "available" };
    },
    create() {
      return null;
    },
    mapError: mapNativeError,
  },
};

export const semanticProviderRegistry = Object.freeze(descriptors);

export function getSemanticProviderDescriptor(name) {
  const descriptor = semanticProviderRegistry[name];
  if (!descriptor) {
    throw semanticProviderError(
      "SEMANTIC_PROVIDER_CONFIG_ERROR",
      `Unsupported job-parser semantic provider: ${name}.`,
      { stage: "configuration" }
    );
  }
  return descriptor;
}
