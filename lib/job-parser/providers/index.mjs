import { createGeminiProvider } from "./gemini.mjs";
import { createOllamaProvider } from "./ollama.mjs";

export const SEMANTIC_PROVIDER_CAPABILITIES = Object.freeze({
  gemini: Object.freeze([
    "structured-output",
    "block-accounting",
    "source-evidence",
    "correction",
  ]),
  ollama: Object.freeze([
    "structured-output",
    "block-accounting",
    "source-evidence",
    "correction",
  ]),
  none: Object.freeze(["deterministic-only"]),
});

export const SEMANTIC_PROVIDER_NAMES = Object.freeze(
  Object.keys(SEMANTIC_PROVIDER_CAPABILITIES)
);
const PROVIDERS = new Set(SEMANTIC_PROVIDER_NAMES);

function providerError(code, message, cause) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function numericOverride(env, name, { allowZero = false } = {}) {
  if (env[name] === undefined || env[name] === "") return undefined;
  const value = Number(env[name]);
  const valid = Number.isInteger(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) {
    throw providerError(
      "SEMANTIC_PROVIDER_CONFIG_ERROR",
      `${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`
    );
  }
  return value;
}

export function resolveSemanticProviderName({
  cli,
  env = process.env,
  config,
} = {}) {
  const name =
    cli ??
    env.JOB_PARSER_PROVIDER ??
    config?.jobParser?.semanticProvider ??
    "gemini";
  if (!PROVIDERS.has(name)) {
    throw providerError(
      "SEMANTIC_PROVIDER_CONFIG_ERROR",
      `Unsupported job-parser semantic provider: ${name}.`
    );
  }
  return name;
}

export function resolveSemanticProviderOptions(
  name,
  config,
  env = process.env
) {
  if (!PROVIDERS.has(name)) {
    throw providerError(
      "SEMANTIC_PROVIDER_CONFIG_ERROR",
      `Unsupported job-parser semantic provider: ${name}.`
    );
  }
  if (name === "none") return {};
  const configured = config?.jobParser?.providers?.[name] ?? {};
  if (name === "gemini") {
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
  }
  return {
    ...configured,
    model: env.JOB_PARSER_OLLAMA_MODEL || env.OLLAMA_MODEL || configured.model,
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
}

function neutralCode(error) {
  const suffix = String(error?.code ?? "").replace(/^(?:GEMINI|OLLAMA)_/u, "");
  if (suffix === "CONFIG_ERROR") return "SEMANTIC_PROVIDER_CONFIG_ERROR";
  if (suffix === "MODEL_NOT_FOUND") return "SEMANTIC_PROVIDER_CONFIG_ERROR";
  if (suffix === "AUTH_ERROR") return "SEMANTIC_PROVIDER_AUTH_ERROR";
  if (suffix === "TIMEOUT") return "SEMANTIC_PROVIDER_TIMEOUT";
  if (suffix === "RATE_LIMIT") return "SEMANTIC_PROVIDER_RATE_LIMIT";
  if (["SCHEMA_ERROR", "EVIDENCE_ERROR", "RESPONSE_ERROR"].includes(suffix))
    return "SEMANTIC_PROVIDER_RESPONSE_ERROR";
  return "SEMANTIC_PROVIDER_REQUEST_ERROR";
}

function wrap(provider, name) {
  return async (input) => {
    try {
      return await provider(input);
    } catch (error) {
      if (String(error?.code ?? "").startsWith("SEMANTIC_PROVIDER_"))
        throw error;
      throw providerError(
        neutralCode(error),
        `${name} semantic extraction failed. ${error.message}`,
        error
      );
    }
  };
}

export function describeSemanticProvider(name, config, env = process.env) {
  const options = resolveSemanticProviderOptions(name, config, env);
  return {
    name,
    model: options.model ?? null,
    capabilities: SEMANTIC_PROVIDER_CAPABILITIES[name],
  };
}

export function getSemanticProviderDiagnostics({
  selected,
  config,
  env = process.env,
} = {}) {
  return SEMANTIC_PROVIDER_NAMES.map((name) => {
    try {
      const details = describeSemanticProvider(name, config, env);
      const configured =
        name === "none" || name === "ollama" || Boolean(env.GEMINI_API_KEY);
      return {
        ...details,
        selected: name === selected,
        configured,
        availability:
          name === "none"
            ? "available"
            : configured
              ? "not-checked"
              : "misconfigured",
        ...(configured ? {} : { issue: "GEMINI_API_KEY is not configured." }),
      };
    } catch (error) {
      return {
        name,
        model: null,
        capabilities: SEMANTIC_PROVIDER_CAPABILITIES[name],
        selected: name === selected,
        configured: false,
        availability: "misconfigured",
        issue: error.message,
      };
    }
  });
}

export function createSemanticProvider({
  name,
  config,
  env = process.env,
  onRawResponse,
  dependencies = {},
} = {}) {
  if (!PROVIDERS.has(name)) {
    throw providerError(
      "SEMANTIC_PROVIDER_CONFIG_ERROR",
      `Unsupported job-parser semantic provider: ${name}.`
    );
  }
  if (name === "none")
    return {
      provider: null,
      info: describeSemanticProvider(name, config, env),
    };
  const options = {
    ...resolveSemanticProviderOptions(name, config, env),
    onRawResponse,
  };
  try {
    const provider =
      name === "gemini"
        ? createGeminiProvider({
            ...options,
            apiKey: dependencies.apiKey ?? env.GEMINI_API_KEY,
            fetchImpl: dependencies.fetchImpl,
          })
        : createOllamaProvider({ ...options, chat: dependencies.chat });
    return {
      provider: wrap(provider, name),
      info: describeSemanticProvider(name, config, env),
    };
  } catch (error) {
    if (String(error?.code ?? "").startsWith("SEMANTIC_PROVIDER_")) throw error;
    throw providerError(
      neutralCode(error),
      `${name} semantic provider is not configured correctly. ${error.message}`,
      error
    );
  }
}
