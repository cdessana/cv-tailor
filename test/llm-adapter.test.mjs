import assert from "node:assert/strict";
import test from "node:test";
import { adaptGeminiSchema, parseJsonObject } from "../scripts/llm.mjs";

test("adapts JSON Schema types to the legacy Gemini schema format", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      rewritten: { type: "string" },
      scores: { type: "array", items: { type: "integer" } },
    },
  };

  assert.deepEqual(adaptGeminiSchema(schema), {
    type: "OBJECT",
    properties: {
      enabled: { type: "BOOLEAN" },
      rewritten: { type: "STRING" },
      scores: { type: "ARRAY", items: { type: "INTEGER" } },
    },
  });
});

test("extracts a JSON object from a provider response with a prose preface", () => {
  const response =
    'Here is the requested content:\n```json\n{"rewritten":"Text with { braces }"}\n```';

  assert.deepEqual(parseJsonObject(response), {
    rewritten: "Text with { braces }",
  });
});

test("rejects responses without a JSON object", () => {
  assert.throws(
    () => parseJsonObject("I could not produce the requested data."),
    /did not contain a valid JSON object/
  );
});
