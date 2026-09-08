import test from "node:test";
import assert from "node:assert/strict";
import { runSchemaProbe } from "../scripts/job-parser-schema-probe.mjs";

const success = ids => ({ status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ blocks: Object.fromEntries(ids.map(id => [id, {
  status: "extracted", reason: "", metadata: {}, alternatives: [],
  items: [{ type: "item", value: "Node.js", kind: "skill", classification: "required", evidence: { quote: "Node.js is required." } }],
}])) }) }] } }] }) });

test("probe varies only schema block keys and separates rejection from availability", async () => {
  const requests = [];
  const results = await runSchemaProbe({ apiKey: "fake-key", logger: {}, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const ids = body.generationConfig.responseJsonSchema.properties.blocks.required;
    if (ids.length === 10) return { status: 400, ok: false, text: async () => "INVALID_ARGUMENT" };
    if (ids.length === 15) return { status: 503, ok: false, text: async () => "Unavailable" };
    return success(ids);
  } });
  assert.equal(requests.length, 4);
  assert.deepEqual(results.map(r => r.blocks), [3, 5, 10, 15]);
  assert.deepEqual(results.map(r => r.outcome), ["accepted_and_valid", "accepted_and_valid", "request_rejected", "inconclusive_transport_failure"]);
  for (const request of requests) {
    assert.deepEqual(request.contents, requests[0].contents);
    assert.deepEqual(request.generationConfig.responseJsonSchema.$defs, requests[0].generationConfig.responseJsonSchema.$defs);
  }
  assert.ok(results.every(r => r.requestBytes > r.schemaBytes && r.elapsedMs >= 0));
});

test("HTTP 200 with malformed output is distinct from HTTP rejection", async () => {
  const results = await runSchemaProbe({ apiKey: "fake-key", logger: {}, fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ candidates: [] }) }) });
  assert.ok(results.every(r => r.outcome === "accepted_invalid_output"));
});

test("network diagnostics do not leak credentials and missing key sends no requests", async () => {
  const logs = [];
  const results = await runSchemaProbe({ apiKey: "secret-value", logger: { info: x => logs.push(x) }, fetchImpl: async () => { throw new Error("secret-value"); } });
  assert.equal(JSON.stringify({ results, logs }).includes("secret-value"), false);
  assert.ok(results.every(r => r.outcome === "inconclusive_transport_failure"));
  await assert.rejects(runSchemaProbe({ apiKey: "", fetchImpl: () => assert.fail("must not call fetch") }), /GEMINI_CONFIG_ERROR/);
});
