import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";

const input = { originalText: "Requirements\n- Node.js", sections: [], unresolved: [] };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const valid = { items: [{ type: "item", value: "Node.js", kind: "skill", classification: "required", evidence: { quote: "Node.js" } }] };

test("returns schema-valid structured Gemini output without network", async () => {
  let request;
  let rawResponse;
  const provider = createGeminiProvider({ apiKey: "test-secret", onRawResponse: (text) => { rawResponse = text; }, fetchImpl: async (url, options) => { request = { url, options }; return response({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] }); } });
  assert.deepEqual(await provider(input), valid);
  assert.equal(rawResponse, JSON.stringify(valid));
  assert.match(request.url, /key=test-secret/);
  assert.match(request.options.body, /application\/json/);
  assert.match(request.options.body, /Review every unresolved source unit/);
  assert.match(request.options.body, /explicit OR\/OU relationship/);
  const requestBody = JSON.parse(request.options.body);
  assert.deepEqual(requestBody.generationConfig.responseSchema, {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Intermediate job parser extraction",
    type: "object",
    additionalProperties: false,
    properties: requestBody.generationConfig.responseSchema.properties,
    required: ["items"],
    definitions: requestBody.generationConfig.responseSchema.definitions,
  });
  assert.equal(request.options.body.includes("resume"), false);
});

test("requires configuration and rejects malformed/schema-invalid responses", async () => {
  assert.throws(() => createGeminiProvider({ apiKey: "" }), /GEMINI_CONFIG_ERROR/);
  for (const body of [{ candidates: [] }, { candidates: [{ content: { parts: [{ text: "not json" }] } }] }, { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [] , extra: true }) }] } }] }]) {
    const provider = createGeminiProvider({ apiKey: "x", fetchImpl: async () => response(body) });
    await assert.rejects(() => provider(input), /GEMINI_(RESPONSE|SCHEMA)_ERROR/);
  }
});

test("repairs only the model's responsibility type/kind mix-up", async () => {
  const provider = createGeminiProvider({ apiKey: "x", fetchImpl: async () => response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ type: "responsibility", value: "Mentor engineers", kind: "responsibility", classification: "not-applicable", evidence: { quote: "Mentor engineers" } }] }) }] } }] }) });
  const result = await provider(input);
  assert.equal(result.items[0].type, "item");
  assert.equal(result.items[0].kind, "responsibility");
});

for (const [status, code] of [[401, "GEMINI_AUTH_ERROR"], [429, "GEMINI_RATE_LIMIT"], [500, "GEMINI_REQUEST_ERROR"]]) {
  test(`maps HTTP ${status} to ${code}`, async () => {
    const provider = createGeminiProvider({ apiKey: "x", fetchImpl: async () => response({}, status) });
    await assert.rejects(() => provider(input), new RegExp(code));
  });
}

test("maps timeout and network failures without exposing the key", async () => {
  const timeout = createGeminiProvider({ apiKey: "secret-value", timeoutMs: 1, fetchImpl: (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))) ) });
  await assert.rejects(() => timeout(input), (error) => error.code === "GEMINI_TIMEOUT" && !error.message.includes("secret-value"));
  const network = createGeminiProvider({ apiKey: "secret-value", fetchImpl: async () => { throw new Error("offline"); } });
  await assert.rejects(() => network(input), (error) => error.code === "GEMINI_NETWORK_ERROR" && !error.message.includes("secret-value"));
});
