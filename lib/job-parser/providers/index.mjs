import { isSemanticProviderError, semanticProviderError } from "./errors.mjs";
import {
  getSemanticProviderDescriptor,
  semanticProviderRegistry,
} from "./registry.mjs";

export const SEMANTIC_PROVIDER_NAMES = Object.freeze(
  Object.keys(semanticProviderRegistry)
);
export const SEMANTIC_PROVIDER_CAPABILITIES = Object.freeze(
  Object.fromEntries(
    Object.entries(semanticProviderRegistry).map(([name, descriptor]) => [
      name,
      descriptor.capabilities,
    ])
  )
);

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
  getSemanticProviderDescriptor(name);
  return name;
}

export function resolveSemanticProviderOptions(
  name,
  config,
  env = process.env
) {
  return getSemanticProviderDescriptor(name).resolveOptions(config, env);
}

function wrap(provider, name, descriptor) {
  return async (input) => {
    try {
      return await provider(input);
    } catch (error) {
      if (isSemanticProviderError(error)) throw error;
      throw semanticProviderError(
        descriptor.mapError(error),
        `${name} semantic extraction failed. ${error.message}`,
        { cause: error, provider: name, stage: "request" }
      );
    }
  };
}

export function describeSemanticProvider(name, config, env = process.env) {
  const descriptor = getSemanticProviderDescriptor(name);
  const options = descriptor.resolveOptions(config, env);
  return {
    name,
    model: options.model ?? null,
    capabilities: descriptor.capabilities,
  };
}

export function getSemanticProviderDiagnostics({
  selected,
  config,
  env = process.env,
} = {}) {
  return SEMANTIC_PROVIDER_NAMES.map((name) => {
    const descriptor = getSemanticProviderDescriptor(name);
    try {
      return {
        ...describeSemanticProvider(name, config, env),
        selected: name === selected,
        ...descriptor.diagnose(env, config),
      };
    } catch (error) {
      return {
        name,
        model: null,
        capabilities: descriptor.capabilities,
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
  const descriptor = getSemanticProviderDescriptor(name);
  const options = { ...descriptor.resolveOptions(config, env), onRawResponse };
  try {
    const provider = descriptor.create(options, env, dependencies);
    return {
      provider: provider ? wrap(provider, name, descriptor) : null,
      info: describeSemanticProvider(name, config, env),
    };
  } catch (error) {
    if (isSemanticProviderError(error)) throw error;
    throw semanticProviderError(
      descriptor.mapError(error),
      `${name} semantic provider is not configured correctly. ${error.message}`,
      { cause: error, provider: name, stage: "configuration" }
    );
  }
}
