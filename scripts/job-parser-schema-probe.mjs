import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGeminiRequestProvider } from "../lib/job-parser/providers/gemini.mjs";

const COUNTS = [3, 5, 10, 15];
const SOURCE = "Node.js is required.";
// Deliberately constant across requests: isolate schema block count from JD size.
const PROMPT = `This is a schema acceptance diagnostic. Every block named in the response schema has identical source text: "${SOURCE}". Return every required block. Each block must have status extracted, reason "", metadata {}, alternatives [], and items [{"type":"item","value":"Node.js","kind":"skill","classification":"required","evidence":{"quote":"${SOURCE}"}}]. Do not add fields.`;

export async function runSchemaProbe({ apiKey = process.env.GEMINI_API_KEY, fetchImpl = globalThis.fetch, logger = console } = {}) {
  if (!apiKey) throw new Error("GEMINI_CONFIG_ERROR: GEMINI_API_KEY is not configured.");
  const results = [];
  for (const count of COUNTS) {
    const units = Array.from({ length: count }, (_, i) => ({
      id: `probe-${String(i + 1).padStart(2, "0")}`, originalText: SOURCE,
      text: SOURCE, start: i * (SOURCE.length + 2), end: i * (SOURCE.length + 2) + SOURCE.length,
    }));
    const input = { originalText: units.map(u => u.text).join("\n\n"), sections: [{ heading: null, signal: "required", units }], unresolved: [] };
    const result = { blocks: count, httpStatus: null, schemaBytes: null, requestBytes: null, promptBytes: Buffer.byteLength(PROMPT) };
    logger.info?.(`[schema-probe] Testing ${count} blocks (one request, no retries).`);
    const start = Date.now();
    const provider = createGeminiRequestProvider({ apiKey, maxAttempts: 1, logger: {}, fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body);
      request.contents = [{ role: "user", parts: [{ text: PROMPT }] }];
      result.schemaBytes = Buffer.byteLength(JSON.stringify(request.generationConfig.responseJsonSchema));
      const body = JSON.stringify(request);
      result.requestBytes = Buffer.byteLength(body);
      const response = await fetchImpl(url, { ...options, body });
      result.httpStatus = response.status;
      return response;
    } });
    try {
      const extraction = await provider(input);
      const correct = extraction.items.length === count && extraction.items.every(item => item.type === "item" && item.value === "Node.js" && item.classification === "required");
      result.outcome = correct ? "accepted_and_valid" : "accepted_incomplete_output";
    } catch (error) {
      result.outcome = result.httpStatus === 400 ? "request_rejected"
        : result.httpStatus === 200 ? "accepted_invalid_output" : "inconclusive_transport_failure";
      // Never include raw error/response text: it can contain credentials or URLs.
      result.errorCode = /^GEMINI_[A-Z_]+$/u.test(error.code ?? "") ? error.code : "UNEXPECTED_ERROR";
    }
    result.elapsedMs = Date.now() - start;
    results.push(result);
    logger.info?.(`[schema-probe] ${count} blocks: HTTP ${result.httpStatus ?? "unavailable"}, ${result.outcome}.`);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const results = await runSchemaProbe();
    console.log(JSON.stringify(results, null, 2));
    console.log("One sample per size; this does not establish a fixed API limit. HTTP 429/503 or network failures are inconclusive. No job files written.");
    if (results.some(result => result.outcome !== "accepted_and_valid")) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
