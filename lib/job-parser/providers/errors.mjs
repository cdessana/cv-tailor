export class ProviderAdapterError extends Error {
  constructor(code, message, { cause, provider, stage } = {}) {
    super(`${code}: ${message}`, cause ? { cause } : undefined);
    this.name = "ProviderAdapterError";
    this.code = code;
    if (provider) this.provider = provider;
    if (stage) this.stage = stage;
  }
}

export function providerAdapterError(code, message, options) {
  return new ProviderAdapterError(code, message, options);
}

export class SemanticProviderError extends Error {
  constructor(
    code,
    message,
    { cause, provider, stage, formatCode = true } = {}
  ) {
    super(
      formatCode ? `${code}: ${message}` : message,
      cause ? { cause } : undefined
    );
    this.name = "SemanticProviderError";
    this.code = code;
    if (provider) this.provider = provider;
    if (stage) this.stage = stage;
  }
}

export function semanticProviderError(code, message, options) {
  return new SemanticProviderError(code, message, options);
}

export function isSemanticProviderError(error) {
  return (
    error instanceof SemanticProviderError ||
    String(error?.code ?? "").startsWith("SEMANTIC_PROVIDER_")
  );
}

export function asSemanticStageError(
  error,
  fallbackCode = "SEMANTIC_PROVIDER_RESPONSE_ERROR"
) {
  const code = isSemanticProviderError(error) ? error.code : fallbackCode;
  return new SemanticProviderError(code, `SEMANTIC_ERROR: ${error.message}`, {
    cause: error,
    provider: error?.provider,
    stage: error?.stage ?? "semantic-extraction",
    formatCode: false,
  });
}
