import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";

const input = { ...preprocessJobDescription("Requirements\n- Node.js"), unresolved: [] };
const coverage = [{ unitId: input.sections[0].units[0].id, status: "extracted", itemIndices: [0] }];
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const ordinary = { type: "item", value: "Node.js", kind: "skill", classification: "required", evidence: { quote: "Node.js" } };
const unitId = input.sections[0].units[0].id;
const valid = { status: "extracted", items: [ordinary], alternatives: [], metadata: {}, reason: "" };

test("returns schema-valid structured Gemini output without network", async () => {
  let request;
  let rawResponse;
  const payload = { candidates: [{ content: { parts: [{ functionCall: { name: "extract_block", args: { id: unitId, ...valid } } }] } }] };
  const provider = createGeminiProvider({ apiKey: "test-secret", onRawResponse: (text) => { rawResponse = text; }, fetchImpl: async (url, options) => { request = { url, options }; return response(payload); } });
  assert.deepEqual(await provider(input), { items: [{ ...ordinary, sourceUnitIds: [unitId] }], coverage });
  assert.equal(rawResponse, JSON.stringify(payload));
  assert.match(request.url, /key=test-secret/);
  assert.equal(request.options.headers["content-type"], "application/json");
  assert.match(request.options.body, /For each supplied block/);
  assert.match(request.options.body, /explicit OR\/OU relationship/);
  const requestBody = JSON.parse(request.options.body);
  assert.equal(requestBody.tools[0].functionDeclarations[0].name, "extract_block");
  assert.equal(requestBody.toolConfig.functionCallingConfig.mode, "ANY");
  const prompt = requestBody.contents[0].parts[0].text;
  const blocks = JSON.parse(prompt.split("SOURCE BLOCKS (ordered; each ID is adjacent to its original text):\n")[1]);
  assert.equal(blocks[0].id, unitId);
  assert.equal(blocks[0].text, input.sections[0].units[0].originalText);
  assert.equal(prompt.includes('Every single extracted item must use'), false);
  assert.equal(requestBody.generationConfig, undefined);
  assert.equal(request.options.body.includes("resume"), false);
});

test("requires configuration and rejects malformed/schema-invalid responses", async () => {
  assert.throws(() => createGeminiProvider({ apiKey: "" }), /GEMINI_CONFIG_ERROR/);
  for (const body of [{ candidates: [] }, { candidates: [{ content: { parts: [{ text: "not tool call" }] } }] }]) {
    const provider = createGeminiProvider({ apiKey: "x", fetchImpl: async () => response(body) });
    await assert.rejects(() => provider(input), /GEMINI_(RESPONSE|SCHEMA)_ERROR/);
  }
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
  const logs = [];
  const network = createGeminiProvider({ apiKey: "secret-value", logger: { error: (message) => logs.push(message) }, fetchImpl: async () => { throw new Error("fetch failed: https://example.test/?key=secret-value"); } });
  await assert.rejects(() => network(input), (error) => error.code === "GEMINI_NETWORK_ERROR" && !error.message.includes("secret-value"));
  assert.deepEqual(logs, ["[job-parser] Gemini network request failed."]);
});

test("missing values are rejected and raw block responses remain available", async () => {
  const malformed = structuredClone(valid);
  delete malformed.items[0].value;
  let raw;
  const payload = { candidates: [{ content: { parts: [{ functionCall: { name: "extract_block", args: { id: unitId, ...malformed } } }] } }] };
  const provider=createGeminiProvider({apiKey:"x",logger:{},onRawResponse:text=>{raw=text;},fetchImpl:async()=>response(payload)});
  await assert.rejects(provider(input),/GEMINI_SCHEMA_ERROR/);
  const data = JSON.parse(raw);
  const rawResponse = data.batches ? data.batches[0].response : raw;
  assert.deepEqual(JSON.parse(rawResponse), payload);
});

test("local validation retains restrictions beyond the provider subset", async () => {
  for (const item of [
    { ...ordinary, value: " " },
    { ...ordinary, evidence: { quote: "" } },
    { type: "alternative", operator: "anyOf", values: ["Node.js", "Node.js"], kind: "skill", classification: "required", evidence: { quote: "Node.js" } },
  ]) {
    const payload = { candidates: [{ content: { parts: [{ functionCall: { name: "extract_block", args: { id: unitId, status: "extracted", items: [item], alternatives: [], metadata: {}, reason: "" } } }] } }] };
    const provider=createGeminiProvider({apiKey:"x",logger:{},fetchImpl:async()=>response(payload)});
    await assert.rejects(provider(input),/GEMINI_SCHEMA_ERROR/);
  }
});
