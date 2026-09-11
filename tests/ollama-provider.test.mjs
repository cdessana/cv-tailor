import assert from "node:assert/strict";
import test from "node:test";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
import { createBlockContract } from "../lib/job-parser/providers/block-contract.mjs";
import { createOllamaProvider } from "../lib/job-parser/providers/ollama.mjs";
import { createSemanticProvider } from "../lib/job-parser/providers/index.mjs";
import { ConfigSchema } from "../config/schema.mjs";
import {
  ollamaWireSchema,
  translateOllamaWireResponse,
} from "../lib/job-parser/providers/ollama-wire-contract.mjs";

function blockResult(block) {
  const quote = block.text.replace(/^-\s*/u, "");
  if (quote.includes("Java ou Kotlin")) {
    return {
      status: "extracted",
      items: [],
      alternatives: [
        {
          type: "alternative",
          operator: "anyOf",
          values: ["Java", "Kotlin"],
          kind: "skill",
          classification: "required",
          evidence: { quote },
          ...(block.heading ? { sourceSection: block.heading } : {}),
        },
      ],
      metadata: {},
      reason: "",
    };
  }
  return {
    status: "extracted",
    items: [
      {
        type: "item",
        value: quote,
        kind: "requirement",
        classification: "required",
        evidence: { quote },
        ...(block.heading ? { sourceSection: block.heading } : {}),
      },
    ],
    alternatives: [],
    metadata: {},
    reason: "",
  };
}

function wireRecord(record, recordType, metadataKey = "none") {
  return {
    recordType,
    metadataKey,
    value: record.value ?? "",
    values: record.values ?? [],
    kind: record.kind ?? "none",
    classification: record.classification ?? "none",
    quote: record.evidence.quote,
    examples: (record.examples ?? []).map((example) => example.value),
  };
}

function wireBlock(id, result) {
  return {
    id,
    status: result.status,
    reason: result.reason,
    records: [
      ...result.items.map((record) => wireRecord(record, "item")),
      ...result.alternatives.map((record) => wireRecord(record, "alternative")),
      ...Object.entries(result.metadata).map(([key, record]) =>
        wireRecord(record, "metadata", key)
      ),
    ],
  };
}

test("Ollama preserves Portuguese alternatives across sequential batches", async () => {
  const document = preprocessJobDescription(
    [
      "Requisitos",
      "- Experiência com Java ou Kotlin",
      "- Inglês avançado",
      "- Experiência com APIs REST",
      "- Conhecimento de bancos de dados",
    ].join("\n")
  );
  const blocks = createBlockContract(document).blocks;
  const calls = [];
  const provider = createOllamaProvider({
    model: "test-model",
    batchSize: 2,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async (request) => {
      calls.push(request);
      const call = calls.length - 1;
      const ids = blocks.slice(call * 2, call * 2 + 2).map((block) => block.id);
      return {
        message: {
          content: JSON.stringify({
            blocks: ids.map((id) =>
              wireBlock(
                id,
                blockResult(blocks.find((block) => block.id === id))
              )
            ),
          }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].messages[0].role, "system");
  assert.equal(calls[0].messages[1].role, "user");
  assert.equal(calls[0].format, ollamaWireSchema);
  assert.deepEqual(
    extraction.items.find((item) => item.type === "alternative").values,
    ["Java", "Kotlin"]
  );
  assert.equal(extraction.coverage.length, 4);
});

test("Ollama wire translation rejects missing and duplicate block IDs", () => {
  const blocks = createBlockContract(
    preprocessJobDescription("Requirements\n- Node.js\n- PostgreSQL")
  ).blocks;
  const excluded = (id) => ({
    id,
    status: "excluded",
    reason: "No relevant record.",
    records: [],
  });
  assert.throws(
    () =>
      translateOllamaWireResponse({ blocks: [excluded(blocks[0].id)] }, blocks),
    /missing block IDs/u
  );
  assert.throws(
    () =>
      translateOllamaWireResponse(
        {
          blocks: blocks
            .map((block) => excluded(block.id))
            .concat(excluded(blocks[0].id)),
        },
        blocks
      ),
    /duplicate block ID/u
  );
});

test("Ollama wire translation removes empty placeholders from excluded blocks", () => {
  const blocks = createBlockContract(
    preprocessJobDescription("Company marketing only")
  ).blocks;
  const translated = translateOllamaWireResponse(
    {
      blocks: [
        {
          id: blocks[0].id,
          status: "excluded",
          reason: "Company context only.",
          records: [
            {
              recordType: "item",
              metadataKey: "none",
              value: "",
              values: [],
              kind: "none",
              classification: "not-applicable",
              quote: "Company marketing only",
              examples: [],
            },
          ],
        },
      ],
    },
    blocks
  );
  assert.deepEqual(translated.blocks[blocks[0].id].items, []);
});

test("Ollama passes confirmed metadata to later batches", async () => {
  const document = preprocessJobDescription(
    "About\n- Example\nRequirements\n- Modern cloud experience"
  );
  const blocks = createBlockContract(document).blocks;
  const prompts = [];
  const provider = createOllamaProvider({
    batchSize: 1,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async (request) => {
      prompts.push(request.messages[1].content);
      const id = blocks[prompts.length - 1].id;
      const block = blocks.find((candidate) => candidate.id === id);
      const result =
        block.text === "About"
          ? {
              status: "excluded",
              items: [],
              alternatives: [],
              metadata: {},
              reason: "Standalone context heading.",
            }
          : block.text.includes("Example")
            ? {
                status: "extracted",
                items: [],
                alternatives: [],
                metadata: {
                  company: { value: "Example", evidence: { quote: "Example" } },
                },
                reason: "",
              }
            : blockResult(block);
      return {
        message: {
          content: JSON.stringify({ blocks: [wireBlock(id, result)] }),
        },
      };
    },
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.equal(extraction.metadata.company.value, "Example");
  assert.match(
    prompts[2],
    /Already confirmed metadata: \{"company":"Example"\}/u
  );
});

test("Ollama preserves geographic location and remote-work metadata", async () => {
  const document = preprocessJobDescription(
    "Location\n- São Paulo - SP\n- Trabalho 100% remoto"
  );
  const blocks = createBlockContract(document).blocks;
  const response = {
    blocks: blocks.map((block) => {
      if (block.text === "Location") {
        return wireBlock(block.id, {
          status: "excluded",
          items: [],
          alternatives: [],
          metadata: {},
          reason: "Standalone context heading.",
        });
      }
      const location = block.text.includes("São Paulo");
      const key = location ? "location" : "workArrangement";
      const value = location ? "São Paulo - SP" : "Trabalho 100% remoto";
      return wireBlock(block.id, {
        status: "extracted",
        items: [],
        alternatives: [],
        metadata: { [key]: { value, evidence: { quote: value } } },
        reason: "",
      });
    }),
  };
  const provider = createOllamaProvider({
    batchSize: 3,
    maxAttempts: 1,
    maxCorrections: 0,
    logger: {},
    chat: async () => ({ message: { content: JSON.stringify(response) } }),
  });
  const extraction = await provider({ ...document, unresolved: [] });
  assert.equal(extraction.metadata.location.value, "São Paulo - SP");
  assert.equal(
    extraction.metadata.workArrangement.value,
    "Trabalho 100% remoto"
  );
});

test("Ollama correction exhaustion fails without silently accepting blocks", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  let calls = 0;
  const provider = createOllamaProvider({
    maxAttempts: 1,
    maxCorrections: 2,
    logger: {},
    chat: async () => {
      calls += 1;
      return { message: { content: JSON.stringify({ blocks: {} }) } };
    },
  });
  await assert.rejects(
    () => provider({ ...document, unresolved: [] }),
    /OLLAMA_SCHEMA_ERROR/
  );
  assert.equal(calls, 3);
});

test("Ollama treats an undefined response as correctable and retries", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  const block = createBlockContract(document).blocks.find((candidate) =>
    candidate.text.includes("Modern cloud experience")
  );
  let calls = 0;
  const provider = createOllamaProvider({
    maxAttempts: 1,
    maxCorrections: 1,
    logger: {},
    chat: async () => {
      calls += 1;
      if (calls === 1) return undefined;
      return {
        message: {
          content: JSON.stringify({
            blocks: [wireBlock(block.id, blockResult(block))],
          }),
        },
      };
    },
  });

  const extraction = await provider({ ...document, unresolved: [] });

  assert.equal(calls, 2);
  assert.equal(extraction.items[0].value, "Modern cloud experience");
});

test("Ollama timeout aborts the active request", async () => {
  const document = preprocessJobDescription(
    "Requirements\n- Modern cloud experience"
  );
  let observedSignal;
  const provider = createOllamaProvider({
    timeoutMs: 5,
    maxAttempts: 1,
    logger: {},
    fetchImpl: (_url, options) => {
      observedSignal = options.signal;
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      });
    },
  });
  await assert.rejects(
    () => provider({ ...document, unresolved: [] }),
    /OLLAMA_TIMEOUT/
  );
  assert.equal(observedSignal.aborted, true);
});

for (const [status, code] of [
  [401, "SEMANTIC_PROVIDER_AUTH_ERROR"],
  [429, "SEMANTIC_PROVIDER_RATE_LIMIT"],
]) {
  test(`Ollama HTTP ${status} maps to ${code}`, async () => {
    const document = preprocessJobDescription(
      "Requirements\n- Modern cloud experience"
    );
    const config = ConfigSchema.parse({
      jobParser: { semanticProvider: "ollama" },
    });
    const selected = createSemanticProvider({
      name: "ollama",
      config,
      env: {},
      dependencies: {
        chat: async () => {
          const error = new Error(`HTTP ${status}`);
          error.status_code = status;
          throw error;
        },
      },
    });
    await assert.rejects(
      () => selected.provider({ ...document, unresolved: [] }),
      (error) => error.code === code
    );
  });
}
