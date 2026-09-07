import fs from "node:fs/promises";
import { assertExtraction } from "../extraction-contract.mjs";

const DEFAULT_MODEL = "gemini-3.7-flash";
const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MAX_ATTEMPTS = 3;
const intermediateSchema = JSON.parse(
  await fs.readFile(new URL("../../../schemas/job-parser.schema.json", import.meta.url), "utf8")
);

function providerError(code, message, cause) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function promptFor(input) {
  return [
    "Extract only source-supported job metadata and requirements from the supplied job description.",
    "Return JSON only, matching the intermediate job-parser schema.",
    "Return a top-level object containing only items and, when supported, metadata. Omit optional fields instead of returning null or empty strings.",
    "For each item use either type item with value, kind, classification, evidence, and optional sourceSection, or type alternative with operator anyOf, at least two values, kind, classification, and evidence.",
    "Allowed item kinds are exactly: skill, requirement, responsibility, competency, ambiguous. Allowed classifications are exactly: required, preferred, ambiguous, not-applicable. Responsibilities must use not-applicable; ambiguous kinds must use ambiguous classification. Do not emit any other kind, classification, field, or top-level property.",
    "Every item and present metadata value must include an exact source evidence quote.",
    "Keep responsibilities separate from competencies. Preserve ambiguity and explicit OR groups.",
    "Do not infer technologies, add candidate information, calculate scores, or return final job JSON.",
    "SOURCE:\n" + input.originalText,
    "SECTIONS:\n" + JSON.stringify(input.sections),
    "UNRESOLVED UNITS:\n" + JSON.stringify(input.unresolved),
  ].join("\n\n");
}

export function createGeminiProvider({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 120000),
  maxAttempts = Number(process.env.GEMINI_MAX_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS),
  logger = console,
} = {}) {
  if (!apiKey) throw providerError("GEMINI_CONFIG_ERROR", "GEMINI_API_KEY is not configured.");
  if (typeof fetchImpl !== "function") throw providerError("GEMINI_CONFIG_ERROR", "Fetch is unavailable.");
  return async (input) => {
    logger.info?.(`[job-parser] Gemini request started (model=${model}, unresolved=${input.unresolved?.length ?? 0})`);
    let response;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetchImpl(`${endpoint}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: promptFor(input) }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: intermediateSchema,
            },
          }),
        });
      } catch (error) {
        if (error.name === "AbortError") {
          logger.error?.(`[job-parser] Gemini request timed out after ${timeoutMs}ms.`);
          throw providerError("GEMINI_TIMEOUT", `Gemini request timed out after ${timeoutMs}ms.`, error);
        }
        logger.error?.(`[job-parser] Gemini network request failed: ${error.message}`);
        throw providerError("GEMINI_NETWORK_ERROR", "Gemini request failed.", error);
      } finally {
        clearTimeout(timer);
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) break;
      const delayMs = 1000 * 2 ** (attempt - 1);
      logger.warn?.(`[job-parser] Gemini returned HTTP ${response.status}; retrying in ${delayMs}ms (${attempt}/${maxAttempts - 1}).`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    logger.info?.(`[job-parser] Gemini response received (HTTP ${response.status}).`);
    if (response.status === 401 || response.status === 403) throw providerError("GEMINI_AUTH_ERROR", "Gemini authentication failed.");
    if (response.status === 429) throw providerError("GEMINI_RATE_LIMIT", "Gemini rate limit reached.");
    if (!response.ok) throw providerError("GEMINI_REQUEST_ERROR", `Gemini returned HTTP ${response.status}.`);
    let payload;
    try { payload = await response.json(); } catch (error) { throw providerError("GEMINI_RESPONSE_ERROR", "Gemini returned invalid JSON.", error); }
    const text = payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
    if (!text) throw providerError("GEMINI_RESPONSE_ERROR", "Gemini response did not contain structured content.");
    let extraction;
    try { extraction = JSON.parse(text); } catch (error) { throw providerError("GEMINI_RESPONSE_ERROR", "Gemini returned non-JSON content.", error); }
    try {
      assertExtraction(extraction);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const compactDetail = detail.length > 2400 ? `${detail.slice(0, 2400)}…` : detail;
      logger.error?.(`[job-parser] Gemini output failed intermediate schema validation: ${compactDetail}`);
      throw providerError("GEMINI_SCHEMA_ERROR", `Gemini output failed intermediate schema validation: ${compactDetail}`, error);
    }
    logger.info?.(`[job-parser] Gemini structured extraction validated (${extraction.items.length} items).`);
    return extraction;
  };
}
