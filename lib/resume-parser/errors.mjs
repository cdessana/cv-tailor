export class ResumeParserError extends Error {
  constructor(code, message, { cause, details } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ResumeParserError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function parserErrorPayload(error) {
  if (error instanceof ResumeParserError) return error.toJSON();
  return { code: "RESUME_PARSER_FAILED", message: error?.message ?? String(error) };
}
